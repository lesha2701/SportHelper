import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, type UploadFile } from "@/api/client";
import { deleteChatMessage, getChat, listChatMessages, markChatRead, openChat, sendChatMedia, sendChatMessage } from "@/api/chat";
import { useAuth } from "@/auth/AuthProvider";
import { pickMedia } from "@/lib/pickImage";
import { uuid } from "@/lib/uuid";
import { MAX_MESSAGE_CHARS, type ChatConversation, type ChatMessage } from "@/shared/types/chat";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { AuthImage } from "@/ui/AuthImage";
import { AuthVideo } from "@/ui/AuthVideo";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { MediaViewer, type ViewerItem } from "@/ui/MediaViewer";
import { EmptyView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

const POLL_EVERY_MS = 5000;
const REFRESH_CHAT_EVERY_MS = 30_000;
const PAGE = 30;

const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (d.toDateString() === now.toDateString()) return "Сегодня";
  if (d.toDateString() === yesterday.toDateString()) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; chat: ChatConversation };

/** A chat: of a paid personal training (/chat/booking/<booking>) or of a team (/chat/team/<team>). New messages are
 * fetched every few seconds while the screen is in front. */
export default function ChatScreen() {
  const { kind, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const { user } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<(UploadFile & { video: boolean }) | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const stickRef = useRef(true);
  const keyRef = useRef<string | null>(null);
  const lastIdRef = useRef(0);
  const readRef = useRef(0);

  const chat = load.status === "ready" ? load.chat : null;
  const chatId = chat?.id ?? null;

  const markRead = useCallback((conversationId: string, upTo: number) => {
    if (upTo <= readRef.current) return;
    readRef.current = upTo;
    void markChatRead(conversationId, upTo).catch(() => {
      readRef.current = 0;
    });
  }, []);

  const merge = useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.id - b.id);
    });
  }, []);

  // Open the chat, then its latest page.
  useEffect(() => {
    let cancelled = false;
    openChat({ kind: kind === "team" ? "team" : "booking", id })
      .then(async (opened) => {
        const page = await listChatMessages(opened.id, { limit: PAGE });
        if (cancelled) return;
        setLoad({ status: "ready", chat: opened });
        setMessages(page.items);
        setHasMore(page.hasMoreBefore);
        const last = page.items.at(-1)?.id ?? 0;
        lastIdRef.current = last;
        if (last) markRead(opened.id, last);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoad({ status: "error", message: e instanceof ApiError ? e.message : "Не удалось открыть чат" });
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id, markRead]);

  // New messages every few seconds, only while the app is in front; the chat's own state (may I still write) less often.
  useEffect(() => {
    if (!chatId) return;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      listChatMessages(chatId, { afterId: lastIdRef.current })
        .then((page) => {
          if (page.items.length === 0) return;
          merge(page.items);
          lastIdRef.current = Math.max(lastIdRef.current, page.items.at(-1)?.id ?? 0);
          markRead(chatId, lastIdRef.current);
        })
        .catch(() => undefined);
    }, POLL_EVERY_MS);
    const refresh = setInterval(() => {
      getChat(chatId)
        .then((fresh) => setLoad({ status: "ready", chat: fresh }))
        .catch(() => undefined);
    }, REFRESH_CHAT_EVERY_MS);
    return () => {
      clearInterval(timer);
      clearInterval(refresh);
    };
  }, [chatId, merge, markRead]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!chatId || !oldest) return;
    stickRef.current = false;
    try {
      const page = await listChatMessages(chatId, { beforeId: oldest.id, limit: PAGE });
      merge(page.items);
      setHasMore(page.hasMoreBefore);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось загрузить сообщения");
    }
  }

  async function attach() {
    setError(null);
    const picked = await pickMedia("any");
    if (picked) setFile(picked);
  }

  async function send() {
    if (!chat || sending) return;
    const text = draft.trim();
    if (!text && !file) return;
    setSending(true);
    setError(null);
    keyRef.current ??= uuid();
    const key = keyRef.current;
    try {
      const message = file ? await sendChatMedia(chat.id, file, text, key) : await sendChatMessage(chat.id, text, key);
      stickRef.current = true;
      merge([message]);
      lastIdRef.current = Math.max(lastIdRef.current, message.id);
      setDraft("");
      setFile(null);
      keyRef.current = null;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось отправить. Попробуйте ещё раз.");
      if (e instanceof ApiError && e.code === "chat_closed") {
        getChat(chat.id)
          .then((fresh) => setLoad({ status: "ready", chat: fresh }))
          .catch(() => undefined);
      }
    } finally {
      setSending(false);
    }
  }

  async function remove() {
    const message = deleting;
    setDeleting(null);
    if (!chat || !message) return;
    try {
      await deleteChatMessage(chat.id, message.id);
      setMessages((prev) => prev.map((m) => (m.id === message.id ? { ...m, deleted: true, body: null, attachment: null } : m)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось удалить сообщение");
    }
  }

  const title = chat?.title ?? "Чат";
  if (load.status === "loading") {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title }} />
        <LoadingView />
      </>
    );
  }
  if (load.status === "error") {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title }} />
        <EmptyView title="Чат недоступен" hint={load.message} />
      </>
    );
  }

  const isTeam = load.chat.kind === "team";
  const gallery: ViewerItem[] = messages.flatMap((m) => (m.attachment && !m.deleted ? [{ kind: m.attachment.kind === "photo" ? ("image" as const) : ("video" as const), fileId: m.attachment.fileId }] : []));
  // The day label goes above the first message of each day.
  const labels = messages.map((m) => dayLabel(m.createdAt));

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: load.chat.title }} />
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => stickRef.current && scrollRef.current?.scrollToEnd({ animated: false })}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            stickRef.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 120;
          }}
          scrollEventThrottle={100}
          accessibilityLabel="Сообщения"
        >
          {load.chat.subtitle ? (
            <Text variant="caption" muted style={{ textAlign: "center" }}>
              {load.chat.subtitle}
            </Text>
          ) : null}
          {hasMore ? (
            <Pressable accessibilityRole="button" onPress={() => void loadOlder()} style={[styles.older, { borderColor: colors.border }]}>
              <Text variant="label" style={{ color: colors.primary }}>
                Показать более ранние
              </Text>
            </Pressable>
          ) : null}
          {messages.length === 0 ? (
            <Text muted style={{ textAlign: "center", paddingVertical: 24 }}>
              Сообщений пока нет. Напишите первым.
            </Text>
          ) : null}
          {messages.map((m, index) => {
            const mine = m.senderId === user?.id;
            const separator = index === 0 || labels[index] !== labels[index - 1] ? labels[index] : null;
            const canDelete = !m.deleted && (mine || load.chat.canModerate);
            const photoIndex = m.attachment ? gallery.findIndex((g) => g.fileId === m.attachment!.fileId) : -1;
            const textColor = mine ? colors.primaryText : colors.text;
            return (
              <View key={m.id} style={{ gap: 6 }}>
                {separator ? (
                  <Text variant="caption" muted style={styles.day}>
                    {separator}
                  </Text>
                ) : null}
                <View style={[styles.row, mine ? styles.rowMine : null]}>
                  <View style={[styles.bubble, mine ? { backgroundColor: colors.primary } : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}>
                    {!mine && isTeam ? (
                      <Text variant="caption" style={{ color: colors.primary }}>
                        {m.senderName}
                      </Text>
                    ) : null}
                    {m.deleted ? (
                      <Text style={{ fontStyle: "italic", color: mine ? colors.primaryText : colors.textSecondary }}>Сообщение удалено</Text>
                    ) : (
                      <>
                        {m.attachment?.kind === "photo" ? (
                          <Pressable accessibilityRole="button" accessibilityLabel="Открыть фото" onPress={() => setViewing(photoIndex)}>
                            <AuthImage fileId={m.attachment.fileId} thumb={m.attachment.hasThumb} height={190} />
                          </Pressable>
                        ) : null}
                        {m.attachment?.kind === "video" ? <AuthVideo fileId={m.attachment.fileId} height={190} /> : null}
                        {m.body ? <Text style={{ color: textColor }}>{m.body}</Text> : null}
                      </>
                    )}
                    <View style={styles.meta}>
                      <Text variant="caption" style={{ color: mine ? colors.primaryText : colors.textTertiary, opacity: 0.85 }}>
                        {time(m.createdAt)}
                      </Text>
                      {canDelete ? (
                        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setDeleting(m)}>
                          <Text variant="caption" style={{ color: mine ? colors.primaryText : colors.textSecondary, textDecorationLine: "underline" }}>
                            Удалить
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {load.chat.canSend ? (
          <View style={[styles.composer, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 8 }]}>
            {file ? (
              <View style={[styles.preview, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name={file.video ? "videocam-outline" : "image-outline"} size={18} color={colors.primary} />
                <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                  {file.name}
                </Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Убрать вложение" hitSlop={8} onPress={() => setFile(null)}>
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </Pressable>
              </View>
            ) : null}
            {error ? (
              <Text variant="caption" style={{ color: colors.danger }}>
                {error}
              </Text>
            ) : null}
            <View style={styles.composerRow}>
              <Pressable accessibilityRole="button" accessibilityLabel="Прикрепить фото или видео" hitSlop={6} onPress={attach} style={styles.iconBtn}>
                <Ionicons name="attach" size={24} color={colors.textSecondary} />
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Написать сообщение…"
                placeholderTextColor={colors.textTertiary}
                multiline
                maxLength={MAX_MESSAGE_CHARS}
                accessibilityLabel="Сообщение"
                style={[styles.input, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, color: colors.text }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Отправить"
                disabled={sending || (!draft.trim() && !file)}
                onPress={() => void send()}
                style={[styles.send, { backgroundColor: colors.primary, opacity: sending || (!draft.trim() && !file) ? 0.4 : 1 }]}
              >
                <Ionicons name="send" size={18} color={colors.primaryText} />
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={[styles.closed, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 12 }]}>
            <Text muted style={{ textAlign: "center" }}>
              {load.chat.sendBlockedReason ?? "В этот чат сейчас нельзя писать."}
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>

      <MediaViewer items={gallery} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      <ConfirmModal visible={deleting !== null} title="Удалить сообщение?" message="Оно исчезнет у всех участников чата." confirmLabel="Удалить" destructive onCancel={() => setDeleting(null)} onConfirm={() => void remove()} />
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: 14, gap: 8, flexGrow: 1 },
  older: { alignSelf: "center", borderWidth: 1, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 14, marginBottom: 6 },
  day: { alignSelf: "center", marginTop: 6 },
  row: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  bubble: { maxWidth: "82%", borderRadius: radius.lg, paddingVertical: 8, paddingHorizontal: 12, gap: 4 },
  meta: { flexDirection: "row", gap: 10, justifyContent: "flex-end", alignItems: "center" },
  composer: { borderTopWidth: 1, paddingHorizontal: 10, paddingTop: 8, gap: 6 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: { flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 16 },
  iconBtn: { width: 36, height: 44, alignItems: "center", justifyContent: "center" },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  preview: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: 10 },
  closed: { borderTopWidth: 1, paddingTop: 12, paddingHorizontal: 16 },
});

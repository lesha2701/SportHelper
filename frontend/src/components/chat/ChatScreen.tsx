import { useCallback, useEffect, useRef, useState } from "react";
import { deleteChatMessage, getChat, listChatMessages, markChatRead, openChat, sendChatMedia, sendChatMessage } from "../../api/chat";
import { ApiError } from "../../api/client";
import { MAX_MESSAGE_CHARS, type ChatConversation, type ChatMessage, type ChatTarget } from "../../types/chat";
import { AuthenticatedImage } from "../shared/AuthenticatedImage";
import { AuthenticatedVideo } from "../shared/AuthenticatedVideo";
import { ConfirmModal } from "../shared/ConfirmModal";
import { Icon } from "../shared/Icon";
import { checkVideo, usePreviewUrl } from "../shared/pendingMedia";
import { StateScreen } from "../StateScreen";
import sharedStyles from "../teams/teams.module.css";
import styles from "./chat.module.css";

const POLL_EVERY_MS = 5000;
const REFRESH_CHAT_EVERY_MS = 30_000;
const PAGE = 30;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm";

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

/** One chat: a personal training's (after it is paid) or a team's. New messages are fetched every few seconds while the page is open. */
export function ChatScreen({
  token,
  target,
  myUserId,
  onBack,
  embedded = false,
}: {
  token: string;
  target: ChatTarget;
  myUserId: string;
  onBack: () => void;
  /** Inside another screen (a team's «Чат» tab): no header and no «Назад» of its own. */
  embedded?: boolean;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ChatMessage | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  // One key per message being written: pressing «Отправить» twice, or retrying after a lost answer, can only ever create one message.
  // It is made when the message is first sent and dropped once the message went through.
  const keyRef = useRef<string | null>(null);
  const lastIdRef = useRef(0);
  const readRef = useRef(0);
  const preview = usePreviewUrl(file);

  const chat = load.status === "ready" ? load.chat : null;
  const chatId = chat?.id ?? null;

  const markRead = useCallback(
    (id: string, upTo: number) => {
      if (upTo <= readRef.current) return;
      readRef.current = upTo;
      void markChatRead(token, id, upTo).catch(() => {
        readRef.current = 0;
      });
    },
    [token],
  );

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
    openChat(token, target)
      .then(async (opened) => {
        const page = await listChatMessages(token, opened.id, { limit: PAGE });
        if (cancelled) return;
        setLoad({ status: "ready", chat: opened });
        setMessages(page.items);
        setHasMore(page.hasMoreBefore);
        const last = page.items.at(-1)?.id ?? 0;
        lastIdRef.current = last;
        if (last) markRead(opened.id, last);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoad({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось открыть чат" });
      });
    return () => {
      cancelled = true;
    };
  }, [token, target.kind, target.id, markRead]);

  // New messages, every few seconds, only while the page is in front.
  useEffect(() => {
    if (!chatId) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      listChatMessages(token, chatId, { afterId: lastIdRef.current })
        .then((page) => {
          if (page.items.length === 0) return;
          merge(page.items);
          lastIdRef.current = Math.max(lastIdRef.current, page.items.at(-1)?.id ?? 0);
          markRead(chatId, lastIdRef.current);
        })
        .catch(() => undefined);
    }, POLL_EVERY_MS);
    const refresh = setInterval(() => {
      getChat(token, chatId)
        .then((fresh) => setLoad({ status: "ready", chat: fresh }))
        .catch(() => undefined);
    }, REFRESH_CHAT_EVERY_MS);
    return () => {
      clearInterval(timer);
      clearInterval(refresh);
    };
  }, [token, chatId, merge, markRead]);

  // Stay at the bottom while new messages arrive, unless the person scrolled up to read older ones.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const loadOlder = async () => {
    const oldest = messages[0];
    if (!chatId || !oldest) return;
    const el = listRef.current;
    const before = el ? el.scrollHeight : 0;
    stickRef.current = false;
    try {
      const page = await listChatMessages(token, chatId, { beforeId: oldest.id, limit: PAGE });
      merge(page.items);
      setHasMore(page.hasMoreBefore);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before; // keep what the person was reading in place
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось загрузить сообщения");
    }
  };

  const pick = async (picked: File | null) => {
    setError(null);
    if (!picked) return;
    if (picked.type.startsWith("video/")) {
      const problem = await checkVideo(picked);
      if (problem) return setError(problem);
    }
    setFile(picked);
  };

  const send = async () => {
    if (!chat || sending) return;
    const text = draft.trim();
    if (!text && !file) return;
    setSending(true);
    setError(null);
    keyRef.current ??= crypto.randomUUID();
    const key = keyRef.current;
    try {
      const message = file ? await sendChatMedia(token, chat.id, file, text, key) : await sendChatMessage(token, chat.id, text, key);
      stickRef.current = true;
      merge([message]);
      lastIdRef.current = Math.max(lastIdRef.current, message.id);
      setDraft("");
      setFile(null);
      keyRef.current = null;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить. Попробуйте ещё раз.");
      if (err instanceof ApiError && err.code === "chat_closed") getChat(token, chat.id).then((fresh) => setLoad({ status: "ready", chat: fresh })).catch(() => undefined);
    } finally {
      setSending(false);
    }
  };

  const remove = async () => {
    if (!chat || !deleting) return;
    try {
      await deleteChatMessage(token, chat.id, deleting.id);
      setMessages((prev) => prev.map((m) => (m.id === deleting.id ? { ...m, deleted: true, body: null, attachment: null } : m)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить сообщение");
    } finally {
      setDeleting(null);
    }
  };

  if (load.status === "loading") return <StateScreen kind="loading" title="Открываем чат…" />;
  if (load.status === "error") {
    return (
      <div className={styles.screen}>
        {!embedded && (
          <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
            <Icon name="chevron-left" size={16} />
            Назад
          </button>
        )}
        <StateScreen kind="empty" title="Чат недоступен" description={load.message} />
      </div>
    );
  }

  const isTeam = load.chat.kind === "team";
  let lastDay = "";
  return (
    <div className={styles.screen}>
      {!embedded && (
        <div className={styles.head}>
          <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
            <Icon name="chevron-left" size={16} />
            Назад
          </button>
          <div className={styles.headText}>
            <h1 className={styles.title}>{load.chat.title}</h1>
            {load.chat.subtitle && <p className={styles.subtitle}>{load.chat.subtitle}</p>}
          </div>
        </div>
      )}

      <div className={styles.panel}>
        <div className={styles.list} ref={listRef} onScroll={onScroll} aria-label="Сообщения" role="log">
          {hasMore && (
            <button type="button" className={styles.older} onClick={() => void loadOlder()}>
              Показать более ранние
            </button>
          )}
          {messages.length === 0 && <p className={styles.empty}>Сообщений пока нет. Напишите первым.</p>}
          {messages.map((m) => {
            const mine = m.senderId === myUserId;
            const day = dayLabel(m.createdAt);
            const separator = day !== lastDay ? day : null;
            lastDay = day;
            const canDelete = !m.deleted && (mine || load.chat.canModerate);
            return (
              <div key={m.id} style={{ display: "contents" }}>
                {separator && <span className={styles.day}>{separator}</span>}
                <div className={mine ? styles.rowMine : styles.row}>
                  <div className={mine ? styles.bubbleMine : styles.bubble}>
                    {!mine && isTeam && <span className={styles.sender}>{m.senderName}</span>}
                    {m.deleted ? (
                      <p className={styles.deleted}>Сообщение удалено</p>
                    ) : (
                      <>
                        {m.attachment?.kind === "photo" && (
                          <AuthenticatedImage token={token} fileId={m.attachment.fileId} alt={m.attachment.filename} className={styles.media} thumb={m.attachment.hasThumb} zoomable />
                        )}
                        {m.attachment?.kind === "video" && <AuthenticatedVideo token={token} fileId={m.attachment.fileId} className={styles.media} zoomable />}
                        {m.body && <p className={styles.text}>{m.body}</p>}
                      </>
                    )}
                    <div className={styles.meta}>
                      <span>{time(m.createdAt)}</span>
                      {canDelete && (
                        <button type="button" className={styles.linkButton} onClick={() => setDeleting(m)}>
                          Удалить
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {load.chat.canSend ? (
          <div className={styles.composer}>
            {file && (
              <div className={styles.preview}>
                {file.type.startsWith("video/") ? <video className={styles.previewMedia} src={preview ?? undefined} muted /> : <img className={styles.previewMedia} src={preview ?? undefined} alt="" />}
                <span className={styles.previewName}>{file.name}</span>
                <button type="button" className={styles.linkButton} onClick={() => setFile(null)}>
                  Убрать
                </button>
              </div>
            )}
            {error && <p className={styles.error}>{error}</p>}
            <div className={styles.composerRow}>
              <label className={styles.iconButton} title="Прикрепить фото или видео (видео — до 1 минуты и 100 МБ)" aria-label="Прикрепить фото или видео">
                <Icon name="paperclip" size={18} />
                <input
                  className={styles.hiddenInput}
                  type="file"
                  accept={ACCEPT}
                  onChange={(e) => {
                    void pick(e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                />
              </label>
              <textarea
                className={styles.input}
                value={draft}
                rows={1}
                maxLength={MAX_MESSAGE_CHARS}
                placeholder="Написать сообщение…"
                aria-label="Сообщение"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button type="button" className={styles.sendButton} onClick={() => void send()} disabled={sending || (!draft.trim() && !file)} aria-label="Отправить">
                <Icon name="send" size={18} />
              </button>
            </div>
          </div>
        ) : (
          <p className={styles.closed}>{load.chat.sendBlockedReason ?? "В этот чат сейчас нельзя писать."}</p>
        )}
      </div>

      {deleting && (
        <ConfirmModal
          title="Удалить сообщение?"
          description="Оно исчезнет у всех участников чата."
          confirmLabel="Удалить"
          danger
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

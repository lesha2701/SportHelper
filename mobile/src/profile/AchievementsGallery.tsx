import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { ApiError } from "@/api/client";
import { deleteProfileMedia, listProfileMedia, uploadProfilePhoto, uploadProfileVideo } from "@/api/profileMedia";
import { toFormError } from "@/lib/formError";
import { pickMedia } from "@/lib/pickImage";
import { useLoad } from "@/lib/useLoad";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { AuthImage } from "@/ui/AuthImage";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { MediaViewer } from "@/ui/MediaViewer";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";

/** «Достижения»: the photos and videos a person shows on their profile (as on the website). Editable on one's own
 * profile; on someone else's it only shows, and is hidden when empty. */
export function AchievementsGallery({ userId, editable }: { userId: string; editable: boolean }) {
  const { colors } = useTheme();
  const media = useLoad(() => listProfileMedia(userId), [userId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  if (media.loading && !media.data) return null;
  const items = media.data ?? [];
  if (!editable && items.length === 0) return null;

  async function add(kind: "image" | "video") {
    const file = await pickMedia(kind);
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      if (file.video) await uploadProfileVideo(file);
      else await uploadProfilePhoto(file);
      media.reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === "video_too_long") setError("Видео должно быть короче 1 минуты.");
      else if (e instanceof ApiError && e.code === "unsupported_media_type") setError(file.video ? "Видео должно быть в формате MP4, MOV или WEBM." : "Фото должно быть в формате JPEG, PNG, WEBP или GIF.");
      else setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setRemoving(null);
    try {
      await deleteProfileMedia(id);
      media.reload();
    } catch (e) {
      setError(toFormError(e).message);
    }
  }

  return (
    <Card>
      <Text variant="heading">Достижения</Text>
      {error ? <Notice kind="danger">{error}</Notice> : null}
      {media.error && !media.data ? <Notice kind="danger">{media.error}</Notice> : null}
      <View style={styles.grid}>
        {items.map((m, i) => (
          <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={m.mediaType === "photo" ? "Открыть фото" : "Открыть видео"} onPress={() => setViewing(i)} style={styles.tile}>
            {m.mediaType === "photo" ? (
              <AuthImage fileId={m.fileId} height={140} />
            ) : (
              <View style={[styles.videoTile, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="play-circle" size={42} color={colors.primary} />
                <Text variant="caption" muted>
                  Видео
                </Text>
              </View>
            )}
            {editable ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Удалить" hitSlop={6} onPress={() => setRemoving(m.id)} style={[styles.delete, { backgroundColor: colors.overlay }]}>
                <Ionicons name="trash-outline" size={15} color="#fff" />
              </Pressable>
            ) : null}
          </Pressable>
        ))}
        {editable ? (
          <>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void add("image")} style={[styles.tile, styles.addTile, { borderColor: colors.border }]}>
              <Ionicons name="image-outline" size={24} color={colors.primary} />
              <Text variant="label">{busy ? "Загрузка…" : "Фото"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void add("video")} style={[styles.tile, styles.addTile, { borderColor: colors.border }]}>
              <Ionicons name="videocam-outline" size={24} color={colors.primary} />
              <Text variant="label">Видео</Text>
              <Text variant="caption" muted>
                до 1 мин
              </Text>
            </Pressable>
          </>
        ) : null}
      </View>
      <MediaViewer items={items.map((m) => ({ kind: m.mediaType === "photo" ? "image" : "video", fileId: m.fileId }))} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
      <ConfirmModal visible={removing !== null} title="Удалить из достижений?" confirmLabel="Удалить" destructive onCancel={() => setRemoving(null)} onConfirm={() => removing && void remove(removing)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexBasis: "48%", flexGrow: 1, height: 140, borderRadius: radius.md, overflow: "hidden" },
  videoTile: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  addTile: { borderWidth: 1.5, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 4 },
  delete: { position: "absolute", top: 6, right: 6, width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});

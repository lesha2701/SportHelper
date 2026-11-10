import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { createComplaint, REPORT_REASONS, type ComplaintReason, type ComplaintTarget } from "@/api/complaints";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Button } from "./Button";
import { Choice } from "./Choice";
import { Notice } from "./Notice";
import { Text } from "./Text";
import { TextField } from "./TextField";

/** "Пожаловаться" on a profile, an offer or a public photo/video. Hidden on the person's own things. */
export function ReportButton({ targetType, targetId, ownerUserId }: { targetType: ComplaintTarget; targetId: string; ownerUserId?: string | null }) {
  const { user } = useAuth();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ComplaintReason | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user || (ownerUserId && ownerUserId === user.id)) return null;

  const needsComment = reason === "other";
  const ready = reason !== null && (!needsComment || comment.trim().length >= 3);

  async function send() {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await createComplaint({ targetType, targetId, reason, comment: comment.trim() || null });
      setOpen(false);
      setReason(null);
      setComment("");
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button title="Пожаловаться" variant="ghost" onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={() => {}}>
            <Text variant="heading">Пожаловаться</Text>
            <Choice options={REPORT_REASONS.map((r) => ({ value: r.value, title: r.label }))} value={reason} onChange={setReason} />
            {reason ? <TextField label={needsComment ? "Опишите причину *" : "Комментарий"} value={comment} onChangeText={setComment} multiline numberOfLines={3} maxLength={1000} /> : null}
            {error ? <Notice kind="danger">{error}</Notice> : null}
            <View style={styles.actions}>
              <Button title="Отмена" variant="secondary" onPress={() => setOpen(false)} style={styles.action} />
              <Button title="Отправить" onPress={send} loading={busy} disabled={!ready} style={styles.action} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 20 },
  sheet: { borderWidth: 1, borderRadius: radius.lg, padding: 20, gap: 12, maxWidth: 480, width: "100%", alignSelf: "center" },
  actions: { flexDirection: "row", gap: 12 },
  action: { flex: 1 },
});

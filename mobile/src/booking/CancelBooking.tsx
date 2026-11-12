import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { cancelBooking, getCancelPreview } from "@/api/bookings";
import { toFormError } from "@/lib/formError";
import { formatStart } from "@/shared/lib/bookingLabels";
import { MIN_COACH_REASON, cancelledBy, previewText, refundLine, type CancelSide } from "@/shared/lib/cancelText";
import type { Booking, CancelPreview, Cancellation } from "@/shared/types/booking";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** Who cancelled and when, the reason and the money: shown in the card of a cancelled booking. */
export function CancellationNote({ cancellation, side }: { cancellation: Cancellation | null; side: CancelSide }) {
  const { colors } = useTheme();
  if (!cancellation) return null;
  const line = refundLine(cancellation, side);
  return (
    <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
      <Text variant="label">{cancelledBy(cancellation, side)}</Text>
      {cancellation.reason ? <Text muted>Причина: {cancellation.reason}</Text> : null}
      {line ? (
        <Text variant="caption" style={cancellation.refundStatus === "failed" ? { color: colors.danger } : undefined} muted={cancellation.refundStatus !== "failed"}>
          {line}
        </Text>
      ) : null}
    </View>
  );
}

/** «Отменить запись»: shown only when the server says it can be cancelled. The sheet first asks the server what the
 * cancellation means for the money, then cancels. The coach has to give a reason (the server insists too). */
export function CancelBooking({ booking, side, onCancelled }: { booking: Booking; side: CancelSide; onCancelled: (updated: Booking) => void }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<CancelPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setPreview(null);
    setLoadError(null);
    getCancelPreview(booking.id)
      .then((result) => current && setPreview(result))
      .catch((e: unknown) => current && setLoadError(toFormError(e).message));
    return () => {
      current = false;
    };
  }, [open, booking.id]);

  if (!booking.canCancel) return null;

  function close() {
    if (busy) return;
    setOpen(false);
    setReason("");
    setError(null);
  }

  async function confirm() {
    const text = reason.trim();
    if (side === "coach" && text.length < MIN_COACH_REASON) {
      setError(`Укажите причину отмены (не короче ${MIN_COACH_REASON} знаков): игрок увидит её.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await cancelBooking(booking.id, text || null);
      setOpen(false);
      setReason("");
      onCancelled(updated);
    } catch (e) {
      // keep the sheet open with the server's own words
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  const person = side === "coach" ? booking.athleteFullName : booking.coachFullName;
  return (
    <>
      <Button title="Отменить запись" variant="secondary" onPress={() => setOpen(true)} />
      <BottomSheet
        visible={open}
        title="Отменить запись?"
        onClose={close}
        footer={
          <>
            <Button title="Отменить запись" variant="danger" onPress={() => void confirm()} loading={busy} disabled={!preview || loadError !== null} />
            <Button title="Не отменять" variant="secondary" onPress={close} disabled={busy} />
          </>
        }
      >
        <Text muted>
          {booking.listingTitle ? `${booking.listingTitle} · ` : ""}
          {formatStart(booking.startsAt)} · {person}
        </Text>
        {!preview && !loadError ? <Text muted>Считаем условия отмены…</Text> : null}
        {preview ? <Notice>{previewText(preview, side)}</Notice> : null}
        {loadError ? <Notice kind="danger">{loadError}</Notice> : null}
        {preview && !loadError ? (
          <TextField
            label={side === "coach" ? "Причина (обязательно)" : "Причина (необязательно)"}
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={3}
            maxLength={500}
          />
        ) : null}
        {error ? <Notice kind="danger">{error}</Notice> : null}
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  note: { borderRadius: radius.md, padding: 12, gap: 4 },
});

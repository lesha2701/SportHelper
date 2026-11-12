import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { confirmSession, getSessionCode, reportSessionProblem, verifySessionCode } from "@/api/bookings";
import { toFormError } from "@/lib/formError";
import { PROBLEMS_OF, PROBLEM_LABELS, confirmationLine, formatCode, formatMoment, type ConfirmSide } from "@/shared/lib/sessionText";
import type { Booking, SessionCode, SessionProblemKind } from "@/shared/types/booking";
import { useTheme } from "@/theme/ThemeProvider";
import { fonts, radius } from "@/theme/tokens";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** «Подтвердить», «Показать код» (player), «Ввести код» (coach), «Сообщить о проблеме» (both): only what the server allows now.
 * The block says in words whether the session took place and what happens next (docs/session-confirmation.md). */
export function SessionConfirmation({ booking, side, onChange }: { booking: Booking; side: ConfirmSide; onChange: () => void }) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<SessionCode | null>(null);
  const [entering, setEntering] = useState(false);
  const [reporting, setReporting] = useState(false);

  const c = booking.sessionConfirmation;
  if (!c) return null;
  const line = confirmationLine(c, side);
  const anyAction = c.canConfirm || c.canGetCode || c.canEnterCode || c.canReportProblem;
  if (!line && !anyAction) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.box, { backgroundColor: colors.surfaceAlt }]}>
      {line ? (
        <Text variant="label" style={c.state === "disputed" ? { color: colors.danger } : undefined}>
          {line}
        </Text>
      ) : null}
      {c.disputeText && c.state === "disputed" ? <Text muted>«{c.disputeText}»</Text> : null}
      {error ? <Notice kind="danger">{error}</Notice> : null}
      {c.canConfirm ? (
        <Button
          title="Подтвердить тренировку"
          loading={busy}
          onPress={() =>
            void run(async () => {
              await confirmSession(booking.id);
              onChange();
            })
          }
        />
      ) : null}
      {c.canGetCode ? <Button title="Показать код тренеру" variant="secondary" disabled={busy} onPress={() => void run(async () => setCode(await getSessionCode(booking.id)))} /> : null}
      {c.canEnterCode ? <Button title="Ввести код игрока" disabled={busy} onPress={() => setEntering(true)} /> : null}
      {c.canReportProblem ? <Button title="Сообщить о проблеме" variant="secondary" disabled={busy} onPress={() => setReporting(true)} /> : null}

      <CodeSheet code={code} onClose={() => setCode(null)} />
      <EnterCodeSheet
        visible={entering}
        bookingId={booking.id}
        onClose={() => setEntering(false)}
        onDone={() => {
          setEntering(false);
          onChange();
        }}
      />
      <ProblemSheet
        visible={reporting}
        side={side}
        bookingId={booking.id}
        onClose={() => setReporting(false)}
        onDone={() => {
          setReporting(false);
          onChange();
        }}
      />
    </View>
  );
}

/** The one-time code of an in-person session, big enough to be read from across the table. */
function CodeSheet({ code, onClose }: { code: SessionCode | null; onClose: () => void }) {
  const { colors } = useTheme();
  return (
    <BottomSheet visible={code !== null} title="Код для тренера" onClose={onClose} footer={<Button title="Закрыть" variant="secondary" onPress={onClose} />}>
      {code ? (
        <>
          <Text accessibilityLabel={`Код ${code.code.split("").join(" ")}`} style={[styles.code, { color: colors.primary }]}>
            {formatCode(code.code)}
          </Text>
          <Text muted>
            Покажите код тренеру: он введёт его у себя, и тренировка будет подтверждена. Код действует до {formatMoment(code.expiresAt)}. Не сообщайте его, если тренировки не было.
          </Text>
        </>
      ) : null}
    </BottomSheet>
  );
}

/** The coach types the six digits the player shows. */
function EnterCodeSheet({ visible, bookingId, onClose, onDone }: { visible: boolean; bookingId: string; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await verifySessionCode(bookingId, typed);
      setTyped("");
      onDone();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title="Код игрока"
      onClose={onClose}
      footer={
        <>
          <Button title="Подтвердить" onPress={() => void send()} loading={busy} disabled={!typed.trim()} />
          <Button title="Отмена" variant="secondary" onPress={onClose} disabled={busy} />
        </>
      }
    >
      <Text muted>Попросите игрока открыть запись и нажать «Показать код тренеру».</Text>
      <TextField label="Шесть цифр" value={typed} onChangeText={setTyped} keyboardType="number-pad" maxLength={9} autoComplete="one-time-code" />
      {error ? <Notice kind="danger">{error}</Notice> : null}
    </BottomSheet>
  );
}

/** What went wrong with the session; the money waits for an administrator. */
function ProblemSheet({ visible, side, bookingId, onClose, onDone }: { visible: boolean; side: ConfirmSide; bookingId: string; onClose: () => void; onDone: () => void }) {
  const kinds = PROBLEMS_OF[side];
  const [kind, setKind] = useState<SessionProblemKind>(kinds[0] ?? "other");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const trimmed = text.trim();
    if (kind === "other" && !trimmed) {
      setError("Опишите, что случилось.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await reportSessionProblem(bookingId, kind, trimmed || null);
      setText("");
      onDone();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet
      visible={visible}
      title="Что случилось?"
      onClose={onClose}
      footer={
        <>
          <Button title="Отправить" variant="danger" onPress={() => void send()} loading={busy} />
          <Button title="Отмена" variant="secondary" onPress={onClose} disabled={busy} />
        </>
      }
    >
      <Text muted>
        {side === "coach"
          ? "Оплата за занятие будет заморожена, решение примет администратор."
          : "Оплата тренеру будет заморожена, решение примет администратор. Если подтвердится, что занятия не было, деньги вернутся вам."}
      </Text>
      <Choice options={kinds.map((k) => ({ value: k, title: PROBLEM_LABELS[k] }))} value={kind} onChange={setKind} />
      <TextField
        label={kind === "other" ? "Описание (обязательно)" : "Подробности (необязательно)"}
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={3}
        maxLength={1000}
      />
      {error ? <Notice kind="danger">{error}</Notice> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: radius.md, padding: 12, gap: 8 },
  code: { fontFamily: fonts.display, fontSize: 56, lineHeight: 64, textAlign: "center", letterSpacing: 4 },
});

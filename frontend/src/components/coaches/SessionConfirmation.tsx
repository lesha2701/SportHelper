// frontend/src/components/coaches/SessionConfirmation.tsx
import { useState } from "react";
import { confirmSession, getSessionCode, reportSessionProblem, verifySessionCode } from "../../api/bookings";
import { ApiError } from "../../api/client";
import type { Booking, SessionCode, SessionConfirmation as Confirmation, SessionProblemKind } from "../../types/booking";
import profileStyles from "../profile/profile.module.css";
import confirmStyles from "../shared/ConfirmModal.module.css";
import styles from "./coaches.module.css";

export type ConfirmSide = "athlete" | "coach";

/** A session's time is the session's wall-clock time, shown as it is (UTC), like everywhere in the bookings. */
const formatSessionTime = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** A real moment (when a code stops working): in the reader's own time. */
const formatMoment = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

export const PROBLEM_LABELS: Record<SessionProblemKind, string> = {
  athlete_no_show: "Игрок не пришёл",
  coach_no_show: "Тренер не пришёл",
  not_conducted: "Тренировка не состоялась",
  other: "Другое",
};

/** What each side may report (the server checks the same). */
const PROBLEMS_OF: Record<ConfirmSide, SessionProblemKind[]> = {
  athlete: ["coach_no_show", "not_conducted", "other"],
  coach: ["athlete_no_show", "other"],
};

/** The line about whether the session took place, seen from the side of whoever reads it (null where there is nothing to say yet). */
export function confirmationLine(c: Confirmation, side: ConfirmSide): string | null {
  const auto = formatSessionTime(c.windowClosesAt);
  switch (c.state) {
    case "scheduled":
      return null;
    case "awaiting":
      return side === "athlete"
        ? `Тренировка прошла? Подтвердите её или сообщите о проблеме. Без ответа подтвердится автоматически ${auto}.`
        : `Ждём подтверждения игрока. Без ответа тренировка подтвердится автоматически ${auto}.`;
    case "confirmed":
      if (c.confirmedMethod === "code") return "Тренировка подтверждена кодом игрока.";
      return side === "athlete" ? "Вы подтвердили тренировку." : "Игрок подтвердил тренировку.";
    case "auto_confirmed":
      return "Тренировка подтверждена автоматически.";
    case "disputed": {
      const what = c.disputeKind ? PROBLEM_LABELS[c.disputeKind].toLowerCase() : "проблема";
      if (c.disputedByRole === side) return `Вы сообщили: ${what}. Решение примет администратор.`;
      const who = c.disputedByRole === "coach" ? "Тренер" : "Игрок";
      return side === "athlete"
        ? `${who} сообщил: ${what}. Решение примет администратор; если это не так — напишите в поддержку.`
        : `${who} сообщил: ${what}. Оплата заморожена до решения администратора.`;
    }
    case "resolved_released":
      return side === "athlete" ? "Спор решён: оплата осталась у тренера." : "Спор решён: оплата за занятие ваша.";
    case "resolved_refunded":
      return side === "athlete" ? "Спор решён: деньги возвращаются вам." : "Спор решён: деньги возвращены игроку.";
  }
}

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** «Подтвердить», «Показать код» (athlete), «Ввести код» (coach), «Сообщить о проблеме» (both): only what the server allows now. */
export function SessionConfirmation({
  token,
  booking,
  side,
  onChange,
}: {
  token: string;
  booking: Booking;
  side: ConfirmSide;
  onChange: (updated: Booking) => void;
}) {
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

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.paymentBox} onClick={(e) => e.stopPropagation()}>
      {line && <p className={c.state === "disputed" ? styles.paymentDue : profileStyles.subtitle}>{line}</p>}
      {c.disputeText && c.state === "disputed" && <p className={profileStyles.subtitle}>«{c.disputeText}»</p>}
      {error && <p className={profileStyles.error}>{error}</p>}
      <div className={styles.sessionActions}>
        {c.canConfirm && (
          <button
            type="button"
            className={profileStyles.buttonPrimary}
            disabled={busy}
            onClick={() => void run(async () => onChange(await confirmSession(token, booking.id)), "Не удалось подтвердить тренировку")}
          >
            Подтвердить тренировку
          </button>
        )}
        {c.canGetCode && (
          <button
            type="button"
            className={profileStyles.buttonSecondary}
            disabled={busy}
            onClick={() => void run(async () => setCode(await getSessionCode(token, booking.id)), "Не удалось получить код")}
          >
            Показать код тренеру
          </button>
        )}
        {c.canEnterCode && (
          <button type="button" className={profileStyles.buttonPrimary} disabled={busy} onClick={() => setEntering(true)}>
            Ввести код игрока
          </button>
        )}
        {c.canReportProblem && (
          <button type="button" className={profileStyles.buttonSecondary} disabled={busy} onClick={() => setReporting(true)}>
            Сообщить о проблеме
          </button>
        )}
      </div>
      {code && <CodeSheet code={code} onClose={() => setCode(null)} />}
      {entering && (
        <EnterCodeSheet
          submit={(typed) => verifySessionCode(token, booking.id, typed)}
          onClose={() => setEntering(false)}
          onDone={(updated) => {
            setEntering(false);
            onChange(updated);
          }}
        />
      )}
      {reporting && (
        <ProblemSheet
          side={side}
          submit={(kind, text) => reportSessionProblem(token, booking.id, kind, text)}
          onClose={() => setReporting(false)}
          onDone={(updated) => {
            setReporting(false);
            onChange(updated);
          }}
        />
      )}
    </div>
  );
}

function CodeSheet({ code, onClose }: { code: SessionCode; onClose: () => void }) {
  return (
    <div className={confirmStyles.backdrop} role="dialog" aria-modal="true" aria-label="Код для тренера">
      <div className={confirmStyles.sheet}>
        <h2 className={confirmStyles.title}>Код для тренера</h2>
        <p className={styles.sessionCodeValue} aria-label={`Код ${code.code.split("").join(" ")}`}>
          {code.code.slice(0, 3)} {code.code.slice(3)}
        </p>
        <p className={confirmStyles.description}>
          Покажите код тренеру — он введёт его у себя, и тренировка будет подтверждена. Код действует до {formatMoment(code.expiresAt)}.
          Не сообщайте его, если тренировки не было.
        </p>
        <div className={confirmStyles.actions}>
          <button type="button" className={confirmStyles.cancelButton} onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function EnterCodeSheet({
  submit,
  onClose,
  onDone,
}: {
  submit: (code: string) => Promise<Booking>;
  onClose: () => void;
  onDone: (updated: Booking) => void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await submit(typed));
    } catch (err) {
      setError(errorText(err, "Не удалось проверить код"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={confirmStyles.backdrop} role="dialog" aria-modal="true" aria-label="Код игрока">
      <div className={confirmStyles.sheet}>
        <h2 className={confirmStyles.title}>Код игрока</h2>
        <p className={confirmStyles.description}>Попросите игрока открыть запись и нажать «Показать код тренеру».</p>
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Шесть цифр</span>
          <input
            className={profileStyles.input}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && typed.trim() && void send()}
          />
        </label>
        {error && <p className={profileStyles.error}>{error}</p>}
        <div className={confirmStyles.actions}>
          <button type="button" className={confirmStyles.confirmButton} disabled={busy || !typed.trim()} onClick={() => void send()}>
            {busy ? "…" : "Подтвердить"}
          </button>
          <button type="button" className={confirmStyles.cancelButton} disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

function ProblemSheet({
  side,
  submit,
  onClose,
  onDone,
}: {
  side: ConfirmSide;
  submit: (kind: SessionProblemKind, text: string | null) => Promise<Booking>;
  onClose: () => void;
  onDone: (updated: Booking) => void;
}) {
  const kinds = PROBLEMS_OF[side];
  const [kind, setKind] = useState<SessionProblemKind>(kinds[0] ?? "other");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    const trimmed = text.trim();
    if (kind === "other" && !trimmed) {
      setError("Опишите, что случилось.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await submit(kind, trimmed || null));
    } catch (err) {
      setError(errorText(err, "Не удалось отправить сообщение"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={confirmStyles.backdrop} role="dialog" aria-modal="true" aria-label="Сообщить о проблеме">
      <div className={confirmStyles.sheet}>
        <h2 className={confirmStyles.title}>Что случилось?</h2>
        <p className={confirmStyles.description}>
          {side === "coach"
            ? "Оплата за занятие будет заморожена, решение примет администратор."
            : "Оплата тренеру будет заморожена, решение примет администратор. Если подтвердится, что занятия не было, деньги вернутся вам."}
        </p>
        <fieldset className={styles.problemKinds}>
          {kinds.map((k) => (
            <label key={k} className={styles.problemKind}>
              <input type="radio" name="problem-kind" checked={kind === k} onChange={() => setKind(k)} />
              {PROBLEM_LABELS[k]}
            </label>
          ))}
        </fieldset>
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>{kind === "other" ? "Описание (обязательно)" : "Подробности (необязательно)"}</span>
          <textarea className={profileStyles.textarea} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
        </label>
        {error && <p className={profileStyles.error}>{error}</p>}
        <div className={confirmStyles.actions}>
          <button type="button" className={confirmStyles.dangerButton} disabled={busy} onClick={() => void send()}>
            {busy ? "…" : "Отправить"}
          </button>
          <button type="button" className={confirmStyles.cancelButton} disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

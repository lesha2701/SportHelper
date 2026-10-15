import { useState } from "react";
import { createComplaint, type ComplaintReason, type ComplaintTarget } from "../../api/admin";
import { ApiError } from "../../api/client";
import { useOptionalAuth } from "../../context/AuthContext";
import { Icon } from "./Icon";
import confirmStyles from "./ConfirmModal.module.css";
import profileStyles from "../profile/profile.module.css";

export const REPORT_REASONS: { value: ComplaintReason; label: string }[] = [
  { value: "inappropriate", label: "Недопустимый контент" },
  { value: "fraud", label: "Мошенничество" },
  { value: "spam", label: "Спам" },
  { value: "false_info", label: "Ложная информация" },
  { value: "other", label: "Другая причина" },
];

const TARGET_TITLES: Record<ComplaintTarget, string> = {
  user: "Пожаловаться на профиль",
  listing: "Пожаловаться на объявление",
  media: "Пожаловаться на материал",
};

/** "Пожаловаться" for a profile, a listing or a public photo/video. Only for signed-in people and never for their
 * own things (the server refuses both anyway); guests simply do not see it. */
export function ReportButton({
  targetType,
  targetId,
  ownerUserId,
  label = "Пожаловаться",
  iconOnly = false,
  className,
}: {
  targetType: ComplaintTarget;
  targetId: string;
  /** Whose content it is, to hide the button from its own author. */
  ownerUserId?: string | null;
  label?: string;
  iconOnly?: boolean;
  className?: string;
}) {
  const auth = useOptionalAuth();
  const [open, setOpen] = useState(false);
  const state = auth?.state;
  if (!state || state.status !== "ready" || (ownerUserId && state.user.id === ownerUserId)) return null;

  return (
    <>
      <button
        type="button"
        className={className ?? profileStyles.buttonSecondary}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
      >
        <Icon name="flag" size={iconOnly ? 13 : 15} />
        {!iconOnly && label}
      </button>
      {open && <ReportDialog targetType={targetType} targetId={targetId} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportDialog({ targetType, targetId, onClose }: { targetType: ComplaintTarget; targetId: string; onClose: () => void }) {
  const [reason, setReason] = useState<ComplaintReason | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsComment = reason === "other";
  const ready = reason !== null && (!needsComment || comment.trim().length >= 3);

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await createComplaint({ targetType, targetId, reason, comment: comment.trim() || null });
      onClose();
    } catch (err) {
      // The API layer already showed the server's reason as a notification; keep it here too, next to the form.
      setError(err instanceof ApiError ? err.message : "Не удалось отправить жалобу");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={confirmStyles.backdrop} role="dialog" aria-modal="true" aria-label={TARGET_TITLES[targetType]} onClick={(e) => e.stopPropagation()}>
      <div className={confirmStyles.sheet}>
        <h2 className={confirmStyles.title}>{TARGET_TITLES[targetType]}</h2>
        <p className={confirmStyles.description}>Выберите причину. Жалобу увидят только модераторы, автор о ней не узнает.</p>
        <div role="radiogroup" aria-label="Причина жалобы" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {REPORT_REASONS.map((r) => (
            <label key={r.value} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
              <input type="radio" name="report-reason" checked={reason === r.value} onChange={() => setReason(r.value)} disabled={busy} />
              {r.label}
            </label>
          ))}
        </div>
        <label className={profileStyles.field}>
          <span className={profileStyles.label}>{needsComment ? "Опишите, что не так" : "Комментарий (необязательно)"}</span>
          <textarea className={profileStyles.textarea} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} disabled={busy} />
        </label>
        {error && <p className={profileStyles.error}>{error}</p>}
        <div className={confirmStyles.actions}>
          <button type="button" className={confirmStyles.confirmButton} onClick={() => void submit()} disabled={busy || !ready}>
            {busy ? "…" : "Отправить"}
          </button>
          <button type="button" className={confirmStyles.cancelButton} onClick={onClose} disabled={busy}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

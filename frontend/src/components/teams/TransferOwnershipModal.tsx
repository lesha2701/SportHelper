import { useMemo, useState } from "react";
import { transferOwnership } from "../../api/teams";
import { ApiError } from "../../api/client";
import type { TeamMember } from "../../types/team";
import profileStyles from "../profile/profile.module.css";
import modalStyles from "../shared/ConfirmModal.module.css";

interface TransferOwnershipModalProps {
  token: string;
  teamId: string;
  teamName: string;
  candidates: TeamMember[];
  onClose: () => void;
  onDone: () => void;
}

export function TransferOwnershipModal({
  token,
  teamId,
  teamName,
  candidates,
  onClose,
  onDone,
}: TransferOwnershipModalProps) {
  const [selectedId, setSelectedId] = useState<string>(candidates[0]?.userId ?? "");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = candidates.find((c) => c.userId === selectedId);

  const expectedPhrase = useMemo(() => {
    if (!selected) return "";
    return `Я передаю роль основного тренера команды «${teamName}» пользователю ${selected.firstName} ${selected.lastName ?? ""}`.trim();
  }, [selected, teamName]);

  const handleSubmit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await transferOwnership(token, teamId, selected.userId, phrase);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось передать роль");
    } finally {
      setBusy(false);
    }
  };

  if (candidates.length === 0) {
    return (
      <div className={modalStyles.backdrop} role="dialog" aria-modal="true">
        <div className={modalStyles.sheet}>
          <h2 className={modalStyles.title}>Некому передать роль</h2>
          <p className={modalStyles.description}>В команде пока нет других участников.</p>
          <div className={modalStyles.actions}>
            <button type="button" className={modalStyles.cancelButton} onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={modalStyles.backdrop} role="dialog" aria-modal="true">
      <div className={modalStyles.sheet}>
        <h2 className={modalStyles.title}>Передать роль основного тренера</h2>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Кому передать</span>
          <select className={profileStyles.select} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.firstName} {c.lastName ?? ""}
              </option>
            ))}
          </select>
        </label>

        <p className={modalStyles.description}>Чтобы подтвердить, введите точно эту фразу:</p>
        <p className={profileStyles.rowValue}>«{expectedPhrase}»</p>

        <label className={profileStyles.field}>
          <span className={profileStyles.label}>Фраза подтверждения</span>
          <textarea className={profileStyles.textarea} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
        </label>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={modalStyles.actions}>
          <button
            type="button"
            className={modalStyles.dangerButton}
            disabled={busy || phrase.trim() !== expectedPhrase}
            onClick={() => void handleSubmit()}
          >
            {busy ? "…" : "Передать роль"}
          </button>
          <button type="button" className={modalStyles.cancelButton} disabled={busy} onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from "react";
import { blockMember, removeMember, updateMember } from "../../api/teams";
import { ApiError } from "../../api/client";
import type { TeamMember, TeamRole } from "../../types/team";
import { ConfirmModal } from "../shared/ConfirmModal";
import profileStyles from "../profile/profile.module.css";
import modalStyles from "../shared/ConfirmModal.module.css";

interface MemberActionsModalProps {
  token: string;
  teamId: string;
  member: TeamMember;
  actorRole: TeamRole;
  onClose: () => void;
  onChanged: () => void;
  onViewProfile: () => void;
}

type Step = "menu" | "confirm-remove" | "confirm-block";

export function MemberActionsModal({
  token,
  teamId,
  member,
  actorRole,
  onClose,
  onChanged,
  onViewProfile,
}: MemberActionsModalProps) {
  const [step, setStep] = useState<Step>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = `${member.firstName} ${member.lastName ?? ""}`.trim();
  const isHeadCoach = actorRole === "head_coach";
  const canManageAssistants = isHeadCoach;
  const canRemove = isHeadCoach || member.role !== "assistant_coach";
  const canBlock = isHeadCoach;

  const setRole = async (role: "captain" | "assistant_coach" | "player") => {
    setBusy(true);
    setError(null);
    try {
      await updateMember(token, teamId, member.userId, { role });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось изменить роль");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeMember(token, teamId, member.userId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось удалить участника");
      setBusy(false);
    }
  };

  const handleBlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await blockMember(token, teamId, member.userId);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось заблокировать участника");
      setBusy(false);
    }
  };

  if (step === "confirm-remove") {
    return (
      <ConfirmModal
        title={`Удалить ${displayName} из команды?`}
        danger
        busy={busy}
        confirmLabel="Удалить"
        onConfirm={handleRemove}
        onCancel={() => setStep("menu")}
      >
        {error && <p className={profileStyles.error}>{error}</p>}
      </ConfirmModal>
    );
  }

  if (step === "confirm-block") {
    return (
      <ConfirmModal
        title={`Заблокировать ${displayName}?`}
        description="Пользователь будет удалён из команды и не сможет подать заявку повторно."
        danger
        busy={busy}
        confirmLabel="Заблокировать"
        onConfirm={handleBlock}
        onCancel={() => setStep("menu")}
      >
        {error && <p className={profileStyles.error}>{error}</p>}
      </ConfirmModal>
    );
  }

  return (
    <div className={modalStyles.backdrop} role="dialog" aria-modal="true">
      <div className={modalStyles.sheet}>
        <h2 className={modalStyles.title}>{displayName}</h2>
        {error && <p className={profileStyles.error}>{error}</p>}
        <div className={modalStyles.actions}>
          <button type="button" className={modalStyles.confirmButton} disabled={busy} onClick={onViewProfile}>
            Посмотреть профиль
          </button>
          {member.role !== "captain" && (
            <button type="button" className={modalStyles.confirmButton} disabled={busy} onClick={() => void setRole("captain")}>
              Назначить капитаном
            </button>
          )}
          {member.role === "captain" && (
            <button type="button" className={modalStyles.confirmButton} disabled={busy} onClick={() => void setRole("player")}>
              Снять с капитана
            </button>
          )}
          {canManageAssistants && member.role !== "assistant_coach" && (
            <button type="button" className={modalStyles.confirmButton} disabled={busy} onClick={() => void setRole("assistant_coach")}>
              Назначить помощником
            </button>
          )}
          {canManageAssistants && member.role === "assistant_coach" && (
            <button type="button" className={modalStyles.confirmButton} disabled={busy} onClick={() => void setRole("player")}>
              Снять с помощника
            </button>
          )}
          {canRemove && (
            <button type="button" className={modalStyles.dangerButton} disabled={busy} onClick={() => setStep("confirm-remove")}>
              Удалить из команды
            </button>
          )}
          {canBlock && (
            <button type="button" className={modalStyles.dangerButton} disabled={busy} onClick={() => setStep("confirm-block")}>
              Заблокировать
            </button>
          )}
          <button type="button" className={modalStyles.cancelButton} disabled={busy} onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

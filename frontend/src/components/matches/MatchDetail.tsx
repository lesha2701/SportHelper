import { useCallback, useEffect, useState } from "react";
import { deleteMatch, getMatch, setMatchResult, setMatchRoster, updateMatch } from "../../api/matches";
import { listMembers } from "../../api/teams";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { ConfirmModal } from "../shared/ConfirmModal";
import { MATCH_RESULT_LABELS, MATCH_STATUS_LABELS, type Match } from "../../types/match";
import type { TeamMember } from "../../types/team";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; match: Match };

export function MatchDetail({
  token,
  matchId,
  canManage,
  onBack,
  onEdit,
  onDeleted,
}: {
  token: string;
  matchId: string;
  canManage: boolean;
  onBack: () => void;
  onEdit: (match: Match) => void;
  onDeleted: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [editingRoster, setEditingRoster] = useState(false);
  const [rosterSelection, setRosterSelection] = useState<string[]>([]);
  const [editingResult, setEditingResult] = useState(false);
  const [ourScore, setOurScore] = useState("");
  const [opponentScore, setOpponentScore] = useState("");
  const [resultComment, setResultComment] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    getMatch(token, matchId)
      .then((match) => setState({ status: "ready", match }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить матч";
        setState({ status: "error", message });
      });
  }, [token, matchId]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!canManage || state.status !== "ready") return;
    listMembers(token, state.match.teamId)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [token, canManage, state]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка матча…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить матч" description={state.message} onRetry={load} />;
  }

  const { match } = state;

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteMatch(token, match.id);
      onDeleted();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось удалить матч");
      setBusy(false);
    }
  };

  const handleSetStatus = async (status: "scheduled" | "cancelled") => {
    setBusy(true);
    setActionError(null);
    try {
      await updateMatch(token, match.id, {
        opponent_name: match.opponentName,
        match_date: match.matchDate,
        start_time: match.startTime,
        location: match.location,
        is_home: match.isHome,
        tournament: match.tournament,
        status,
      });
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось изменить статус");
    } finally {
      setBusy(false);
    }
  };

  const startEditRoster = () => {
    setRosterSelection(match.roster.map((r) => r.userId));
    setEditingRoster(true);
  };

  const toggleRosterMember = (userId: string) => {
    setRosterSelection((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  };

  const handleSaveRoster = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await setMatchRoster(token, match.id, { user_ids: rosterSelection });
      setEditingRoster(false);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось сохранить состав");
    } finally {
      setBusy(false);
    }
  };

  const startEditResult = () => {
    setOurScore(match.ourScore?.toString() ?? "");
    setOpponentScore(match.opponentScore?.toString() ?? "");
    setResultComment(match.comment ?? "");
    setEditingResult(true);
  };

  const handleSaveResult = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await setMatchResult(token, match.id, {
        our_score: Number(ourScore),
        opponent_score: Number(opponentScore),
        comment: resultComment.trim() || null,
      });
      setEditingResult(false);
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Не удалось сохранить итог");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onBack}>
          ← Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <div className={styles.teamCardTop}>
          <h1 className={profileStyles.title}>{match.opponentName}</h1>
          <span className={styles.badge}>{MATCH_STATUS_LABELS[match.status]}</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Дата и время</span>
          <span className={profileStyles.rowValue}>
            {match.matchDate} · {match.startTime.slice(0, 5)}
          </span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Площадка</span>
          <span className={profileStyles.rowValue}>{match.isHome ? "Дома" : "В гостях"}{match.location ? ` · ${match.location}` : ""}</span>
        </div>
        {match.tournament && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Турнир</span>
            <span className={profileStyles.rowValue}>{match.tournament}</span>
          </div>
        )}
        {match.result && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Итог</span>
            <span className={profileStyles.rowValue}>
              {match.ourScore}:{match.opponentScore} · {MATCH_RESULT_LABELS[match.result]}
            </span>
          </div>
        )}
        {match.comment && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Комментарий</span>
            <span className={profileStyles.rowValue}>{match.comment}</span>
          </div>
        )}
      </div>

      {actionError && (
        <div className={profileStyles.card}>
          <p className={profileStyles.error}>{actionError}</p>
        </div>
      )}

      <div className={profileStyles.card}>
        <div className={styles.teamCardTop}>
          <span className={profileStyles.title}>Состав ({match.roster.length})</span>
          {canManage && !editingRoster && (
            <button type="button" className={styles.iconButton} onClick={startEditRoster}>
              Изменить
            </button>
          )}
        </div>

        {!editingRoster &&
          (match.roster.length === 0 ? (
            <p className={profileStyles.subtitle}>Состав ещё не сформирован.</p>
          ) : (
            match.roster.map((member) => (
              <div key={member.userId} className={styles.memberRow}>
                {member.photoUrl ? <img className={styles.avatar} src={member.photoUrl} alt="" /> : <div className={styles.avatar} />}
                <div className={styles.memberInfo}>
                  <span className={styles.memberName}>
                    {member.firstName} {member.lastName ?? ""}
                  </span>
                </div>
              </div>
            ))
          ))}

        {editingRoster && (
          <>
            {members.map((member) => (
              <label key={member.userId} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <input type="checkbox" checked={rosterSelection.includes(member.userId)} onChange={() => toggleRosterMember(member.userId)} />
                <span>
                  {member.firstName} {member.lastName ?? ""}
                </span>
              </label>
            ))}
            <div className={profileStyles.formActions}>
              <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleSaveRoster()} disabled={busy}>
                Сохранить состав
              </button>
              <button type="button" className={profileStyles.buttonSecondary} onClick={() => setEditingRoster(false)} disabled={busy}>
                Отмена
              </button>
            </div>
          </>
        )}
      </div>

      {canManage && (
        <div className={profileStyles.card}>
          {!editingResult ? (
            <button type="button" className={profileStyles.buttonPrimary} onClick={startEditResult}>
              {match.status === "completed" ? "Изменить итог" : "Внести итог матча"}
            </button>
          ) : (
            <>
              <div className={profileStyles.fieldGrid}>
                <label className={profileStyles.field}>
                  <span className={profileStyles.label}>Наш счёт</span>
                  <input className={profileStyles.input} type="number" min={0} value={ourScore} onChange={(e) => setOurScore(e.target.value)} />
                </label>
                <label className={profileStyles.field}>
                  <span className={profileStyles.label}>Счёт соперника</span>
                  <input className={profileStyles.input} type="number" min={0} value={opponentScore} onChange={(e) => setOpponentScore(e.target.value)} />
                </label>
              </div>
              <label className={profileStyles.field}>
                <span className={profileStyles.label}>Комментарий (увидит вся команда)</span>
                <textarea className={profileStyles.textarea} value={resultComment} onChange={(e) => setResultComment(e.target.value)} maxLength={2000} />
              </label>
              <div className={profileStyles.formActions}>
                <button
                  type="button"
                  className={profileStyles.buttonPrimary}
                  onClick={() => void handleSaveResult()}
                  disabled={busy || ourScore === "" || opponentScore === ""}
                >
                  Сохранить итог
                </button>
                <button type="button" className={profileStyles.buttonSecondary} onClick={() => setEditingResult(false)} disabled={busy}>
                  Отмена
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {canManage && (
        <div className={profileStyles.card}>
          {match.status !== "cancelled" && (
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleSetStatus("cancelled")} disabled={busy}>
              Отменить матч
            </button>
          )}
          {match.status === "cancelled" && (
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleSetStatus("scheduled")} disabled={busy}>
              Вернуть в расписание
            </button>
          )}
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => onEdit(match)}>
            Редактировать
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setDeleteConfirmOpen(true)}>
            Удалить матч
          </button>
        </div>
      )}

      {deleteConfirmOpen && (
        <ConfirmModal
          title="Удалить матч?"
          danger
          busy={busy}
          confirmLabel="Удалить"
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { getAttendance, setAttendanceStatus } from "../../api/trainings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import type { Attendance } from "../../types/training";
import styles from "../teams/teams.module.css";
import trainingStyles from "./training.module.css";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; attendance: Attendance[] };

export function AttendanceScreen({
  token,
  trainingId,
  canEdit,
  onBack,
}: {
  token: string;
  trainingId: string;
  canEdit: boolean;
  onBack: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    getAttendance(token, trainingId)
      .then((attendance) => setState({ status: "ready", attendance }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить посещаемость";
        setState({ status: "error", message });
      });
  }, [token, trainingId]);

  useEffect(load, [load]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка посещаемости…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить посещаемость" description={state.message} onRetry={load} />;
  }

  const toggle = async (userId: string, currentStatus: "present" | "absent") => {
    if (!canEdit) return;
    setBusyUserId(userId);
    try {
      await setAttendanceStatus(token, trainingId, userId, currentStatus === "present" ? "absent" : "present");
      load();
    } catch {
      // keep it simple: a failed toggle just leaves the row as-is; the user can retry the tap
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onBack}>
          ← Назад
        </button>
      </div>

      <div className={styles.headerRow}>
        <h1 className={styles.heading}>Посещаемость</h1>
      </div>
      {canEdit && (
        <p className={styles.teamMeta}>Нажмите на игрока, чтобы отметить отсутствие. Остальные считаются присутствовавшими.</p>
      )}

      {state.attendance.map((a) => (
        <button
          key={a.userId}
          type="button"
          className={trainingStyles.attendanceRow}
          onClick={() => void toggle(a.userId, a.status)}
          disabled={!canEdit || busyUserId === a.userId}
          style={{ cursor: canEdit ? "pointer" : "default" }}
        >
          {a.photoUrl ? <img className={styles.avatar} src={a.photoUrl} alt="" /> : <div className={styles.avatar} />}
          <div className={trainingStyles.attendanceInfo}>
            <span className={trainingStyles.attendanceName}>
              {a.firstName} {a.lastName ?? ""}
            </span>
          </div>
          <span className={a.status === "present" ? trainingStyles.statusPresent : trainingStyles.statusAbsent}>
            {a.status === "present" ? "Был(а)" : "Отсутствовал(а)"}
          </span>
        </button>
      ))}
    </div>
  );
}

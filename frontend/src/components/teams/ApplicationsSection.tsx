import { useEffect, useState } from "react";
import { acceptApplication, listApplications, rejectApplication } from "../../api/teams";
import { ApiError } from "../../api/client";
import type { JoinRequest } from "../../types/team";
import profileStyles from "../profile/profile.module.css";
import styles from "./teams.module.css";

interface ApplicationsSectionProps {
  token: string;
  teamId: string;
  onChanged: () => void;
}

export function ApplicationsSection({ token, teamId, onChanged }: ApplicationsSectionProps) {
  const [applications, setApplications] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    listApplications(token, teamId)
      .then(setApplications)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить заявки"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [token, teamId]);

  const handleAccept = async (requestId: string) => {
    setBusyId(requestId);
    try {
      await acceptApplication(token, teamId, requestId);
      setApplications((prev) => prev.filter((a) => a.id !== requestId));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось принять заявку");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (requestId: string) => {
    setBusyId(requestId);
    try {
      await rejectApplication(token, teamId, requestId);
      setApplications((prev) => prev.filter((a) => a.id !== requestId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отклонить заявку");
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Заявки</h2>
        <p className={profileStyles.subtitle}>Загрузка…</p>
      </div>
    );
  }

  return (
    <div className={profileStyles.card}>
      <h2 className={profileStyles.title}>Заявки{applications.length > 0 ? ` (${applications.length})` : ""}</h2>
      {error && <p className={profileStyles.error}>{error}</p>}
      {applications.length === 0 && <p className={profileStyles.subtitle}>Новых заявок нет.</p>}
      {applications.map((app) => (
        <div key={app.id} className={styles.memberRow}>
          {app.photoUrl && <img className={styles.avatar} src={app.photoUrl} alt="" />}
          <div className={styles.memberInfo}>
            <span className={styles.memberName}>
              {app.firstName} {app.lastName ?? ""}
            </span>
            {app.username && <span className={styles.memberMeta}>@{app.username}</span>}
          </div>
          <button
            type="button"
            className={styles.iconButton}
            disabled={busyId === app.id}
            onClick={() => void handleAccept(app.id)}
          >
            Принять
          </button>
          <button
            type="button"
            className={styles.iconButton}
            disabled={busyId === app.id}
            onClick={() => void handleReject(app.id)}
          >
            Отклонить
          </button>
        </div>
      ))}
    </div>
  );
}

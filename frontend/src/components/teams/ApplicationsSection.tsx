import profileStyles from "../profile/profile.module.css";
import styles from "./teams.module.css";
import type { ApplicationsState } from "./useApplications";

/** The list of pending requests, rendered inside the invitations panel. */
export function ApplicationsList({ applications, loading, error, busyId, accept, reject }: ApplicationsState) {
  if (loading) return null;
  return (
    <section aria-label="Заявки на вступление">
      <h3 className={styles.panelSubtitle}>Заявки{applications.length > 0 ? ` (${applications.length})` : ""}</h3>
      {error && <p className={profileStyles.error}>{error}</p>}
      {applications.length === 0 && !error && <p className={profileStyles.subtitle}>Новых заявок нет.</p>}
      {applications.map((app) => (
        <div key={app.id} className={styles.memberRow}>
          {app.photoUrl && <img className={styles.avatar} src={app.photoUrl} alt="" />}
          <div className={styles.memberInfo}>
            <span className={styles.memberName}>
              {app.firstName} {app.lastName ?? ""}
            </span>
            {app.username && <span className={styles.memberMeta}>@{app.username}</span>}
          </div>
          <button type="button" className={styles.iconButton} disabled={busyId === app.id} onClick={() => void accept(app.id)}>
            Принять
          </button>
          <button type="button" className={styles.iconButton} disabled={busyId === app.id} onClick={() => void reject(app.id)}>
            Отклонить
          </button>
        </div>
      ))}
    </section>
  );
}

import { MyTeamsSection } from "./MyTeamsSection";
import styles from "./teams.module.css";

export function MyTeamsScreen({ token, onOpenTeam }: { token: string; onOpenTeam: (teamId: string) => void }) {
  return (
    <div className={styles.screen}>
      <MyTeamsSection token={token} onOpenTeam={onOpenTeam} />
    </div>
  );
}

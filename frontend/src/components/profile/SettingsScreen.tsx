import { Icon } from "../shared/Icon";
import { NotificationSettings } from "./NotificationSettings";
import { ThemeToggle } from "./ThemeToggle";
import sharedStyles from "../teams/teams.module.css";
import profileStyles from "./profile.module.css";

export function SettingsScreen({ token, onBack }: { token: string; onBack: () => void }) {
  return (
    <div className={profileStyles.screen}>
      <div className={sharedStyles.headerRow}>
        <button type="button" className={sharedStyles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <h1 className={profileStyles.pageHeading}>Настройки</h1>

      <ThemeToggle />
      <NotificationSettings token={token} />
    </div>
  );
}

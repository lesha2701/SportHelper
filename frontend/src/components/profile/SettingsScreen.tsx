import { useState } from "react";
import { Icon } from "../shared/Icon";
import { WelcomeGuide } from "../welcome/WelcomeGuide";
import { NotificationSettings } from "./NotificationSettings";
import { PrivacySettings } from "./PrivacySettings";
import { ThemeToggle } from "./ThemeToggle";
import sharedStyles from "../teams/teams.module.css";
import profileStyles from "./profile.module.css";

export function SettingsScreen({
  token,
  onBack,
  roles,
}: {
  token: string;
  onBack: () => void;
  roles?: { player: boolean; coach: boolean };
}) {
  const [showGuide, setShowGuide] = useState(false);

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
      <PrivacySettings token={token} />

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Знакомство с приложением</h2>
        <p className={profileStyles.subtitle}>Короткий обзор возможностей SportArena — можно пересмотреть в любой момент.</p>
        <button type="button" className={profileStyles.buttonSecondary} onClick={() => setShowGuide(true)}>
          <Icon name="sparkles" size={16} />
          Как работает SportArena
        </button>
      </div>

      {showGuide && <WelcomeGuide manual roles={roles} onFinish={() => setShowGuide(false)} />}
    </div>
  );
}

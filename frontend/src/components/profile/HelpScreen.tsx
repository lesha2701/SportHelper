import { Icon } from "../shared/Icon";
import styles from "../teams/teams.module.css";
import profileStyles from "./profile.module.css";

export function HelpScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className={profileStyles.screen}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.iconButton} onClick={onBack}>
          <Icon name="chevron-left" size={16} />
          Назад
        </button>
      </div>

      <div className={profileStyles.card}>
        <h1 className={profileStyles.pageHeading}>О приложении</h1>
        <p className={profileStyles.subtitle}>
          TeamFlow Sports помогает тренерам и игрокам вести дела команды в одном месте: состав, тренировки,
          задания, матчи и статистика — без переписок и таблиц.
        </p>
      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Команды</h2>
        <p className={profileStyles.subtitle}>
          Создайте команду или присоединитесь по ссылке-приглашению. Внутри команды доступны разделы:
        </p>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Обзор</span>
          <span className={profileStyles.rowValue}>основные данные команды, состав, статистика и настройки</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Тренировки</span>
          <span className={profileStyles.rowValue}>расписание, посещаемость, отчёты</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Задания</span>
          <span className={profileStyles.rowValue}>поручения игрокам с дедлайном и проверкой тренером</span>
        </div>
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Матчи</span>
          <span className={profileStyles.rowValue}>календарь игр и результаты</span>
        </div>
      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Библиотека</h2>
        <p className={profileStyles.subtitle}>
          Доступна тренерам. Здесь хранятся упражнения, планы тренировок (наборы упражнений по разминке,
          основной части и заминке) и шаблоны заданий — их можно один раз описать и переиспользовать в любой
          команде.
        </p>
      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Календарь</h2>
        <p className={profileStyles.subtitle}>
          Собирает в одном списке тренировки, матчи и дедлайны заданий по всем вашим командам. Вкладка
          «Просрочено» показывает тренировки, которые остались неотмеченными после назначенной даты — чтобы
          они не терялись в общем списке.
        </p>
      </div>

      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>Профиль</h2>
        <p className={profileStyles.subtitle}>
          Личные данные игрока и/или тренера (можно вести оба сразу и переключаться), персональная статистика,
          тема оформления и уведомления.
        </p>
      </div>
    </div>
  );
}

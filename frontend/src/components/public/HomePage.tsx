import { useEffect, useState } from "react";
import { listListings } from "../../api/coachListings";
import { Link } from "../Link";
import { Icon } from "../shared/Icon";
import { Ornament } from "../shared/Ornament";
import type { CoachListingCard } from "../../types/coachListing";
import { PublicShell } from "./PublicShell";
import styles from "./public.module.css";

const STEPS = [
  { title: "Найдите тренера", text: "Каталог открыт для всех: смотрите профили, отзывы, цены и свободное время — без регистрации." },
  { title: "Запишитесь на занятие", text: "Выберите удобный слот. Тренер подтвердит запись, и она появится в вашем календаре." },
  { title: "Тренируйтесь и растите", text: "Задания, итоги занятий и статистика помогают видеть прогресс от тренировки к тренировке." },
];

const PLAYER_POINTS = ["Личный календарь тренировок и матчей", "Записи к тренерам и отзывы после занятий", "Задания, метрики и разбор прогресса"];
const COACH_POINTS = ["Объявления и расписание с доступными слотами", "Команды, составы, матчи и отчёты", "Планы тренировок и библиотека упражнений"];

function PreviewCard({ listing }: { listing: CoachListingCard }) {
  return (
    <Link to={`/coaches?listing=${listing.id}`} className={styles.previewCard}>
      <span className={styles.previewSport}>{listing.sport}</span>
      <h3 className={styles.previewTitle}>{listing.title}</h3>
      <p className={styles.previewMeta}>
        {listing.coachFullName}
        {listing.location ? ` · ${listing.location}` : ""}
        {listing.averageRating !== null ? ` · ★ ${listing.averageRating.toFixed(1)}` : ""}
      </p>
      <span className={styles.previewPrice}>
        {listing.pricePerSession !== null ? `${listing.pricePerSession} ${listing.currency}` : "Цена по запросу"}
      </span>
    </Link>
  );
}

/** The landing page a signed-out visitor sees at "/". */
export function HomePage() {
  const [listings, setListings] = useState<CoachListingCard[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    listListings("", {})
      .then((items) => !cancelled && setListings(items.slice(0, 3)))
      .catch(() => !cancelled && setListings([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PublicShell>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroWaves} aria-hidden="true">
          <Ornament tone="primary" intensity="bold" />
        </div>
        <span className={styles.eyebrow}>Платформа для игроков и тренеров</span>
        <h1 id="hero-title" className={styles.heroTitle}>
          Тренируйся <em>с планом.</em> Расти <em>с командой.</em>
        </h1>
        <p className={styles.heroLead}>
          Находите тренеров, записывайтесь на занятия, ведите календарь, задания и статистику. Один аккаунт — и для игрока, и
          для тренера.
        </p>
        <div className={styles.ctaRow}>
          <Link to="/coaches" className={styles.cta}>
            Найти тренера
          </Link>
          <Link to="/register" className={styles.ctaGhost}>
            Создать аккаунт
          </Link>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="how-title">
        <div className={styles.sectionHead}>
          <h2 id="how-title" className={styles.sectionTitle}>
            Как это работает
          </h2>
        </div>
        <ol className={styles.steps}>
          {STEPS.map((step) => (
            <li key={step.title} className={styles.step}>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepText}>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {listings && listings.length > 0 && (
        <section className={styles.section} aria-labelledby="coaches-title">
          <div className={styles.sectionHead}>
            <h2 id="coaches-title" className={styles.sectionTitle}>
              Тренеры на платформе
            </h2>
            <Link to="/coaches" className={styles.sectionLink}>
              Весь каталог →
            </Link>
          </div>
          <div className={styles.previewGrid}>
            {listings.map((listing) => (
              <PreviewCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      )}

      <section className={styles.section} aria-labelledby="roles-title">
        <div className={styles.sectionHead}>
          <h2 id="roles-title" className={styles.sectionTitle}>
            Для кого
          </h2>
        </div>
        <div className={styles.roles}>
          <div className={styles.roleCard}>
            <h3 className={styles.stepTitle}>Игрокам</h3>
            <ul className={styles.roleList}>
              {PLAYER_POINTS.map((point) => (
                <li key={point}>
                  <Icon name="check" size={16} />
                  {point}
                </li>
              ))}
            </ul>
          </div>
          <div className={`${styles.roleCard} ${styles.roleCardDark}`}>
            <h3 className={styles.stepTitle}>Тренерам</h3>
            <ul className={styles.roleList}>
              {COACH_POINTS.map((point) => (
                <li key={point}>
                  <Icon name="check" size={16} />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className={styles.bottomCta}>
        <h2>Готовы начать?</h2>
        <Link to="/register" className={styles.cta}>
          Зарегистрироваться
        </Link>
      </section>
    </PublicShell>
  );
}

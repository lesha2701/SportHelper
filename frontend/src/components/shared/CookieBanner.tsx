import { useState } from "react";
import { readCookieChoice, saveCookieChoice, type CookieChoice } from "../../legal/cookieConsent";
import { DOCUMENTS } from "../../legal/documents";
import { Link } from "../Link";
import styles from "./CookieBanner.module.css";

/** Shown to a visitor who has not chosen yet, before they register. */
export function CookieBanner() {
  const [chosen, setChosen] = useState<boolean>(() => readCookieChoice() !== null);
  if (chosen) return null;

  const choose = (choice: CookieChoice) => {
    saveCookieChoice(choice);
    setChosen(true);
  };

  return (
    <section className={styles.banner} role="region" aria-label="Файлы cookie">
      <p className={styles.text}>
        Мы используем необходимые cookie для работы Сервиса и, с вашего согласия, аналитические cookie. Подробнее — в{" "}
        <Link to={DOCUMENTS.privacy.path} className={styles.link}>
          Политике обработки персональных данных
        </Link>
        .
      </p>
      <div className={styles.buttons}>
        <button type="button" className={styles.primary} onClick={() => choose("all")}>
          Принять все
        </button>
        <button type="button" className={styles.secondary} onClick={() => choose("necessary")}>
          Только необходимые
        </button>
      </div>
    </section>
  );
}

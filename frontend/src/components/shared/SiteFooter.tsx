import { DOCUMENTS } from "../../legal/documents";
import { Link } from "../Link";
import styles from "./SiteFooter.module.css";

/** The site-wide footer: the agreement and the policy, who runs the service, and where to write about advertising.
 * It is shown on the public pages, on the sign-in / sign-up screens and inside the signed-in app. */
export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span>© {new Date().getFullYear()} SportArenaGlobal</span>
        <Link to={DOCUMENTS.terms.path} className={styles.footerLink}>
          Пользовательское соглашение
        </Link>
        <Link to={DOCUMENTS.privacy.path} className={styles.footerLink}>
          Политика обработки персональных данных
        </Link>
      </div>
      <div className={styles.footerRequisites}>
        <p>ИП Перекрестов Вячеслав Дмитриевич</p>
        <p>ИНН: 770373336381</p>
        <p>ОГРН: 326774600747726</p>
        <p>
          Для связи по вопросам рекламы:{" "}
          <a href="mailto:perekrestov_bus@mail.ru" className={styles.footerLink}>
            perekrestov_bus@mail.ru
          </a>
        </p>
      </div>
    </footer>
  );
}

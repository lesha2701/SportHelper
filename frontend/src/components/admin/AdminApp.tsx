import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getAdminSession, listAdminComplaints, type AdminSession } from "../../api/admin";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import { Link } from "../Link";
import { StateScreen } from "../StateScreen";
import { BrandLogo } from "../shared/BrandLogo";
import { Icon, type IconName } from "../shared/Icon";
import { MfaSection } from "../profile/AccountSecurity";
import { useLocation } from "../../router";
import { DashboardPage } from "./DashboardPage";
import { AuditPage } from "./AuditPage";
import { ComplaintsPage } from "./ComplaintsPage";
import { ModerationPage } from "./ModerationPage";
import { TrainingsPage } from "./TrainingsPage";
import { UsersPage } from "./UsersPage";
import { FinancePage } from "./finance/FinancePage";
import { StepUpProvider } from "./stepUp";
import { AdminContext } from "./adminUi";
import styles from "./admin.module.css";

interface Section {
  path: string;
  label: string;
  icon: IconName;
  render: () => ReactNode;
  /** Shown only to administrators listed as finance administrators (the server decides and re-checks on every request). */
  financeOnly?: boolean;
}

const SECTIONS: Section[] = [
  { path: "/admin", label: "Обзор", icon: "home", render: () => <DashboardPage /> },
  { path: "/admin/users", label: "Пользователи", icon: "users", render: () => <UsersPage /> },
  { path: "/admin/moderation", label: "Модерация", icon: "image", render: () => <ModerationPage /> },
  { path: "/admin/trainings", label: "Тренировки", icon: "dumbbell", render: () => <TrainingsPage /> },
  { path: "/admin/reports", label: "Жалобы", icon: "flag", render: () => <ComplaintsPage /> },
  { path: "/admin/finance", label: "Финансы", icon: "wallet", render: () => <FinancePage />, financeOnly: true },
  { path: "/admin/audit", label: "Журнал", icon: "list", render: () => <AuditPage /> },
];

type Gate =
  | { kind: "loading" }
  | { kind: "denied" }
  | { kind: "failed"; message: string }
  | { kind: "setup" }
  | { kind: "code" }
  | { kind: "ready"; session: AdminSession };

/** Everything here is only a convenience: the server decides on every request. This page just asks it
 * (GET /api/admin/session) which step is still missing, and follows the answer. */
export default function AdminApp() {
  const { state } = useAuth();
  const [gate, setGate] = useState<Gate>({ kind: "loading" });
  const email = state.status === "ready" ? state.user.email : null;

  const check = useCallback(() => {
    getAdminSession()
      .then((session) => {
        if (!session.mfaEnabled) setGate({ kind: "setup" });
        else if (!session.mfaVerified) setGate({ kind: "code" });
        else setGate({ kind: "ready", session });
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setGate({ kind: "denied" });
        else setGate({ kind: "failed", message: error instanceof ApiError ? error.message : "Не удалось проверить доступ" });
      });
  }, []);

  useEffect(check, [check]);
  const context = useMemo(() => ({ recheck: check }), [check]);

  if (gate.kind === "loading") return <StateScreen kind="loading" title="Проверяем доступ…" />;
  if (gate.kind === "denied") {
    return (
      <div className={styles.gate}>
        <div className={styles.gateCard}>
          <StateScreen kind="forbidden" title="Доступ закрыт" description="У этой учётной записи нет доступа к административной панели." />
          <Link to="/" className={styles.button}>
            На сайт
          </Link>
        </div>
      </div>
    );
  }
  if (gate.kind === "failed") return <StateScreen kind="error" title="Не удалось проверить доступ" description={gate.message} onRetry={check} />;

  if (gate.kind === "setup" || gate.kind === "code") {
    return (
      <div className={styles.gate}>
        <div className={styles.gateCard}>
          <div className={styles.card}>
            <h1 className={styles.cardTitle}>Административная панель</h1>
            <p className={styles.pageHint}>
              {gate.kind === "setup"
                ? "Чтобы войти, включите двухфакторную защиту: понадобится приложение-аутентификатор. Вы получите резервные коды на случай потери телефона."
                : "Введите код из приложения-аутентификатора (или один из резервных кодов), чтобы открыть панель."}
            </p>
          </div>
          <MfaSection onChanged={check} />
          <Link to="/" className={styles.button}>
            Вернуться на сайт
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AdminContext.Provider value={context}>
      <StepUpProvider>
        <AdminShell email={email} finance={gate.session.finance} />
      </StepUpProvider>
    </AdminContext.Provider>
  );
}

function AdminShell({ email, finance }: { email: string | null; finance: boolean }) {
  const { path } = useLocation();
  const sections = useMemo(() => SECTIONS.filter((s) => finance || !s.financeOnly), [finance]);
  const current = sections.find((s) => s.path === path) ?? (path === "/admin" ? sections[0] : undefined);
  const [newComplaints, setNewComplaints] = useState(0);

  // The number of untouched complaints next to "Жалобы"; refreshed whenever the administrator moves between sections.
  useEffect(() => {
    listAdminComplaints({ status: "new", targetType: "", reason: "", q: "", limit: 1, offset: 0 })
      .then((page) => setNewComplaints(page.total))
      .catch(() => setNewComplaints(0));
  }, [path]);

  return (
    <div className={styles.layout}>
      <nav className={styles.sidebar} aria-label="Разделы администрирования">
        <div className={styles.brand}>
          <BrandLogo className={styles.brandMark} />
          <span className={styles.brandText}>
            <span className={styles.brandName}>SportArenaGlobal</span>
            <span className={styles.brandSub}>Админ-панель</span>
          </span>
        </div>
        {sections.map((section) => (
          <Link key={section.path} to={section.path} className={current === section ? styles.navItemActive : styles.navItem} aria-current={current === section ? "page" : undefined}>
            <Icon name={section.icon} size={19} />
            {section.label}
            {section.path === "/admin/reports" && newComplaints > 0 && <span className={styles.navBadge}>{newComplaints}</span>}
          </Link>
        ))}
        <div className={styles.sidebarFoot}>
          {email && <span className={styles.who}>{email}</span>}
          <Link to="/" className={styles.buttonGhost}>
            <Icon name="chevron-left" size={16} />
            На сайт
          </Link>
        </div>
      </nav>
      <main className={styles.main}>
        {current ? current.render() : <StateScreen kind="empty" title="Раздел не найден" description="Выберите раздел в меню слева." />}
      </main>
    </div>
  );
}

import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { loginUrl, navigate, safeNext, useLocation } from "./router";
import { ClaimAccountPage } from "./components/auth/ClaimAccountPage";
import { LoginPage } from "./components/auth/LoginPage";
import { RegisterPage } from "./components/auth/RegisterPage";
import {
  ConfirmEmailChangePage,
  ForgotPasswordPage,
  PasswordChangedPage,
  ResetPasswordPage,
  VerifyEmailPage,
} from "./components/auth/TokenPages";
import { LegalDocumentPage } from "./components/legal/LegalDocumentPage";
import { documentByPath } from "./legal/documents";
import { HomePage } from "./components/public/HomePage";
import { PublicCoachesPage } from "./components/public/PublicCoachesPage";
import { PublicShell } from "./components/public/PublicShell";
import { Link } from "./components/Link";
import { CookieBanner } from "./components/shared/CookieBanner";
import { StateScreen } from "./components/StateScreen";
import { PaymentReturnPage } from "./components/payments/PaymentReturnPage";
import { OnboardingGate } from "./components/welcome/OnboardingGate";
import { Workspace } from "./Workspace";

// The administration code is only downloaded by a signed-in administrator who opens /admin. That is a
// convenience, not protection: every admin request is checked again on the server.
const AdminApp = lazy(() => import("./components/admin/AdminApp"));

function Redirect({ to }: { to: string }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to]);
  return <StateScreen kind="loading" title="Переходим…" />;
}

/** Links that only make sense inside the signed-in app (a team invite, a
 * notification's deep link, a booking started as a guest). */
const APP_INTENT_PARAMS = ["invite", "open", "book", "coach", "listing"];

function NotFoundPage() {
  return (
    <PublicShell>
      <StateScreen kind="empty" title="Такой страницы нет" description="Возможно, ссылка устарела или в ней опечатка." />
      <div style={{ display: "flex", justifyContent: "center", paddingBottom: 40 }}>
        <Link to="/" style={{ fontWeight: 600 }}>
          На главную
        </Link>
      </div>
    </PublicShell>
  );
}

/** Pages that work the same for guests and signed-in users (they are opened
 * from an email link, or are plain documents). */
function openPage(path: string): ReactNode | null {
  const legal = documentByPath(path);
  if (legal) return <LegalDocumentPage meta={legal} />;
  switch (path) {
    case "/verify-email":
      return <VerifyEmailPage />;
    case "/confirm-email-change":
      return <ConfirmEmailChangePage />;
    case "/reset-password":
      return <ResetPasswordPage />;
    case "/password-changed":
      return <PasswordChangedPage />;
    case "/claim":
      return <ClaimAccountPage />;
    default:
      return null;
  }
}

function Routes() {
  const { path, search } = useLocation();
  const { state, retry, updateUser } = useAuth();

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Нет связи с сервером" description={state.message} onRetry={retry} />;
  }

  const open = openPage(path);
  if (open) return <>{open}</>;

  const params = new URLSearchParams(search);

  if (state.status === "ready") {
    // Signed in: the auth pages have nothing to offer — continue where the person was headed.
    if (path === "/login" || path === "/register" || path === "/forgot-password") {
      return <Redirect to={safeNext(params.get("next")) ?? "/"} />;
    }
    // The public catalogue is the same screen inside the app, so booking, "my bookings" etc. all work.
    if (path === "/coaches") {
      const keep = new URLSearchParams();
      for (const key of ["coach", "listing"]) if (params.get(key)) keep.set(key, params.get(key)!);
      return <Redirect to={`/${keep.size ? `?${keep}` : ""}`} />;
    }
    if (path === "/payments/return") return <PaymentReturnPage token={state.token} />;
    if (path === "/admin" || path.startsWith("/admin/")) {
      // Anyone who is not flagged as an administrator by the server sees exactly what a missing page looks like.
      if (!state.user.isAdmin) return <NotFoundPage />;
      return (
        <Suspense fallback={<StateScreen kind="loading" title="Загрузка…" />}>
          <AdminApp />
        </Suspense>
      );
    }
    return (
      <OnboardingGate token={state.token} user={state.user} onUserUpdated={updateUser}>
        <Workspace token={state.token} />
      </OnboardingGate>
    );
  }

  // Guest.
  if (path === "/payments/return") return <Redirect to={loginUrl(`${path}${search}`)} />; // sign in, then come straight back to the result
  switch (path) {
    case "/login":
      return <LoginPage />;
    case "/register":
      return <RegisterPage />;
    case "/forgot-password":
      return <ForgotPasswordPage />;
    case "/coaches":
      return <PublicCoachesPage />;
    case "/":
      if (APP_INTENT_PARAMS.some((key) => params.has(key))) {
        // Opened a link meant for the app: sign in first, then come straight back to it.
        return <Redirect to={loginUrl(`/${search}`)} />;
      }
      return <HomePage />;
    default:
      return <NotFoundPage />;
  }
}

/** The cookie question is for visitors who have no account yet. */
function GuestCookieBanner() {
  const { state } = useAuth();
  return state.status === "guest" ? <CookieBanner /> : null;
}

function App() {
  return (
    <AuthProvider>
      <Routes />
      <GuestCookieBanner />
    </AuthProvider>
  );
}

export default App;

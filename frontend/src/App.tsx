import { useEffect, type ReactNode } from "react";
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
import { PrivacyPage, TermsPage } from "./components/legal/LegalPages";
import { HomePage } from "./components/public/HomePage";
import { PublicCoachesPage } from "./components/public/PublicCoachesPage";
import { PublicShell } from "./components/public/PublicShell";
import { Link } from "./components/Link";
import { StateScreen } from "./components/StateScreen";
import { OnboardingGate } from "./components/welcome/OnboardingGate";
import { Workspace } from "./Workspace";

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
  switch (path) {
    case "/terms":
      return <TermsPage />;
    case "/privacy":
      return <PrivacyPage />;
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
    return (
      <OnboardingGate token={state.token} user={state.user} onUserUpdated={updateUser}>
        <Workspace token={state.token} />
      </OnboardingGate>
    );
  }

  // Guest.
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

function App() {
  return (
    <AuthProvider>
      <Routes />
    </AuthProvider>
  );
}

export default App;

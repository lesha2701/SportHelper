import { AuthProvider, useAuth } from "./context/AuthContext";
import { BrowserLogin } from "./components/BrowserLogin";
import { StateScreen } from "./components/StateScreen";
import { OnboardingGate } from "./components/welcome/OnboardingGate";
import { Workspace } from "./Workspace";

function AuthGate() {
  const { state, retry, updateUser } = useAuth();

  switch (state.status) {
    case "loading":
      return <StateScreen kind="loading" title="Выполняется вход…" />;

    case "unavailable":
      return <BrowserLogin />;

    case "forbidden":
      return <StateScreen kind="forbidden" title="Доступ ограничен" description={state.message} />;

    case "error":
      return (
        <StateScreen kind="error" title="Не удалось войти" description={state.message} onRetry={retry} />
      );

    case "ready":
      return (
        <OnboardingGate token={state.token} user={state.user} onUserUpdated={updateUser}>
          <Workspace token={state.token} />
        </OnboardingGate>
      );
  }
}

function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

export default App;

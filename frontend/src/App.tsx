import { AuthProvider, useAuth } from "./context/AuthContext";
import { BrowserLogin } from "./components/BrowserLogin";
import { StateScreen } from "./components/StateScreen";
import { Workspace } from "./Workspace";

function AuthGate() {
  const { state, retry } = useAuth();

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
      return <Workspace token={state.token} />;
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

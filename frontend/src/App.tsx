import { AuthProvider, useAuth } from "./context/AuthContext";
import { StateScreen } from "./components/StateScreen";
import { Workspace } from "./Workspace";

function AuthGate() {
  const { state, retry } = useAuth();

  switch (state.status) {
    case "loading":
      return <StateScreen kind="loading" title="Выполняется вход…" />;

    case "unavailable":
      return (
        <StateScreen
          kind="empty"
          title="Откройте приложение через Telegram"
          description="TeamFlow Sports работает как Mini App внутри Telegram. Запустите бота и нажмите кнопку «Открыть TeamFlow Sports»."
        />
      );

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

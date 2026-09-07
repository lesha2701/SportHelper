// frontend/src/components/coaches/CoachMarketplaceScreen.tsx
import { StateScreen } from "../StateScreen";

export function CoachMarketplaceScreen({ token }: { token: string }) {
  void token;
  return <StateScreen kind="empty" title="Тренеры" description="Список тренеров появится здесь." />;
}

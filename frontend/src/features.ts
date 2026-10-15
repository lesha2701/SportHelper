import { useEffect, useState } from "react";
import { getFeatures } from "./api/features";

/** Whether the Telegram integration is on. Decided by TELEGRAM_ENABLED in the server's .env (nothing to change
 * in the frontend); false until the server has answered, so the options never flash up and vanish. */
export function useTelegramEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getFeatures().then((features) => {
      if (!cancelled) setEnabled(features.telegram);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

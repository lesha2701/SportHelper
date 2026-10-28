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

/** Whether the server can take online payments (YOOKASSA_* in its .env). False until it has answered. */
export function usePaymentsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void getFeatures().then((features) => {
      if (!cancelled) setEnabled(features.payments);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return enabled;
}

/** Which parts of the money contour the server has switched on (all false until it has answered). */
export function useFinanceFeatures(): { trainerBalance: boolean; trainerWithdrawals: boolean } {
  const [state, setState] = useState({ trainerBalance: false, trainerWithdrawals: false });
  useEffect(() => {
    let cancelled = false;
    void getFeatures().then((features) => {
      if (!cancelled) setState({ trainerBalance: features.trainerBalance, trainerWithdrawals: features.trainerWithdrawals });
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

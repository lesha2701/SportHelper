// frontend/src/components/coaches/PlanPickerModal.tsx
import { useEffect, useState } from "react";
import { listMyPlans } from "../../api/plans";
import { setBookingPlan } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import type { Booking } from "../../types/booking";
import type { Plan } from "../../types/plan";
import profileStyles from "../profile/profile.module.css";
import styles from "./coaches.module.css";

/** Lets the coach pick which of their own plans to use for a confirmed
 * booking's session — the athlete then sees it on their training. */
export function PlanPickerModal({
  token,
  booking,
  onClose,
  onSaved,
}: {
  token: string;
  booking: Booking;
  onClose: () => void;
  onSaved: (booking: Booking) => void;
}) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; plans: Plan[] }>({
    status: "loading",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyPlans(token)
      .then((plans) => setState({ status: "ready", plans }))
      .catch((err: unknown) => setState({ status: "error", message: err instanceof ApiError ? err.message : "Не удалось загрузить планы" }));
  }, [token]);

  const choose = async (planId: string | null) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await setBookingPlan(token, booking.id, planId);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить план");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <h2 className={profileStyles.title}>План тренировки для {booking.athleteFullName}</h2>

        {state.status === "loading" && <StateScreen kind="loading" title="Загрузка планов…" />}
        {state.status === "error" && <p className={profileStyles.error}>{state.message}</p>}

        {state.status === "ready" && state.plans.length === 0 && (
          <p className={profileStyles.subtitle}>У вас пока нет сохранённых планов в Библиотеке.</p>
        )}

        {state.status === "ready" && state.plans.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {state.plans.map((plan) => (
              <button
                key={plan.id}
                type="button"
                className={plan.id === booking.trainingPlanId ? profileStyles.buttonPrimary : profileStyles.buttonSecondary}
                onClick={() => void choose(plan.id)}
                disabled={saving}
              >
                {plan.name}
              </button>
            ))}
          </div>
        )}

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={profileStyles.formActions}>
          {booking.trainingPlanId && (
            <button type="button" className={profileStyles.buttonSecondary} onClick={() => void choose(null)} disabled={saving}>
              {saving ? "…" : "Убрать план"}
            </button>
          )}
          <button type="button" className={profileStyles.buttonSecondary} onClick={onClose} disabled={saving}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

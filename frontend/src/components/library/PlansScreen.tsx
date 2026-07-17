import { useCallback, useEffect, useState } from "react";
import { listMyPlans } from "../../api/plans";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { PlanForm } from "./PlanForm";
import { PlanDetail } from "./PlanDetail";
import type { Plan } from "../../types/plan";
import styles from "../teams/teams.module.css";

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; plans: Plan[] };

type View = { screen: "list" } | { screen: "create" } | { screen: "edit"; plan: Plan } | { screen: "detail"; planId: string };

export function PlansScreen({ token }: { token: string }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setState({ status: "loading" });
    listMyPlans(token)
      .then((plans) => setState({ status: "ready", plans }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить планы";
        setState({ status: "error", message });
      });
  }, [token]);

  useEffect(() => {
    if (view.screen === "list") load();
  }, [view, load]);

  if (view.screen === "create") {
    return (
      <PlanForm token={token} onSaved={(plan) => setView({ screen: "detail", planId: plan.id })} onCancel={() => setView({ screen: "list" })} />
    );
  }

  if (view.screen === "edit") {
    return (
      <PlanForm
        token={token}
        initial={view.plan}
        onSaved={(plan) => setView({ screen: "detail", planId: plan.id })}
        onCancel={() => setView({ screen: "detail", planId: view.plan.id })}
      />
    );
  }

  if (view.screen === "detail") {
    return (
      <PlanDetail
        token={token}
        planId={view.planId}
        onBack={() => setView({ screen: "list" })}
        onEdit={(plan) => setView({ screen: "edit", plan })}
        onDeleted={() => setView({ screen: "list" })}
        onDuplicated={(plan) => setView({ screen: "detail", planId: plan.id })}
      />
    );
  }

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка планов…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить планы" description={state.message} onRetry={load} />;
  }

  const filteredPlans = state.plans.filter((plan) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return plan.name.toLowerCase().includes(q) || plan.sport.toLowerCase().includes(q);
  });

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <h1 className={styles.heading}>Планы тренировок</h1>
        <button type="button" className={styles.addButton} onClick={() => setView({ screen: "create" })}>
          + Создать
        </button>
      </div>

      {state.plans.length > 0 && (
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Поиск по названию или виду спорта…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {state.plans.length === 0 ? (
        <StateScreen kind="empty" title="Пока нет планов" description="Соберите первый план из упражнений вашей библиотеки." />
      ) : filteredPlans.length === 0 ? (
        <StateScreen kind="empty" title="Ничего не найдено" description="Попробуйте изменить запрос." />
      ) : (
        filteredPlans.map((plan) => (
          <button key={plan.id} type="button" className={styles.teamCard} onClick={() => setView({ screen: "detail", planId: plan.id })}>
            <div className={styles.teamCardTop}>
              <h2 className={styles.teamName}>{plan.name}</h2>
              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </div>
            <p className={styles.teamMeta}>
              {plan.sport}
              {plan.durationMinutes !== null ? ` · ${plan.durationMinutes} мин` : ""}
            </p>
          </button>
        ))
      )}
    </div>
  );
}

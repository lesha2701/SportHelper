import { useCallback, useEffect, useState } from "react";
import { listMyPlans, sharePlan, duplicatePlan } from "../../api/plans";
import { listMyTeams } from "../../api/teams";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { PlanForm } from "./PlanForm";
import { PlanDetail } from "./PlanDetail";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import type { Plan } from "../../types/plan";
import type { Team } from "../../types/team";
import profileStyles from "../profile/profile.module.css";
import styles from "../teams/teams.module.css";
import libStyles from "./library.module.css";

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; plans: Plan[] };

type View = { screen: "list" } | { screen: "create" } | { screen: "edit"; plan: Plan } | { screen: "detail"; planId: string };

function PlanDetailPanel({
  token,
  plan,
  teams,
  onEdit,
  onOpenFull,
  onChanged,
}: {
  token: string;
  plan: Plan;
  teams: Team[];
  onEdit: () => void;
  onOpenFull: () => void;
  onChanged: () => void;
}) {
  const [teamOpen, setTeamOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dupBusy, setDupBusy] = useState(false);

  const sharedTeams = teams.filter((t) => plan.sharedTeamIds.includes(t.id));
  const unsharedTeams = teams.filter((t) => !plan.sharedTeamIds.includes(t.id));

  const handleShare = async (teamId: string) => {
    setBusy(true);
    setError(null);
    try {
      await sharePlan(token, plan.id, teamId);
      setTeamOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось показать план команде");
    } finally {
      setBusy(false);
    }
  };

  const handleDuplicate = async () => {
    setDupBusy(true);
    setError(null);
    try {
      await duplicatePlan(token, plan.id);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось продублировать план");
    } finally {
      setDupBusy(false);
    }
  };

  return (
    <div className={libStyles.detailPanel}>
      <div className={libStyles.detailBody} style={{ paddingTop: 20 }}>
        <div>
          <span className={libStyles.detailCategory}>{plan.sport}</span>
          <h2 className={libStyles.detailTitle}>{plan.name}</h2>
        </div>
        <p className={libStyles.detailDescription}>{plan.description || "Без описания."}</p>

        <div className={libStyles.detailStatsGrid}>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue}>{plan.durationMinutes ?? "—"}</span>
            <span className={libStyles.detailStatLabel}>минут</span>
          </div>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue}>{plan.exercises.length}</span>
            <span className={libStyles.detailStatLabel}>упражнений</span>
          </div>
          <div className={libStyles.detailStatTile}>
            <span className={libStyles.detailStatValue}>{sharedTeams.length}</span>
            <span className={libStyles.detailStatLabel}>{sharedTeams.length === 1 ? "команда" : "команд"}</span>
          </div>
        </div>

        {plan.exercises.length > 0 && (
          <div className={libStyles.detailExerciseList}>
            {plan.exercises
              .slice()
              .sort((a, b) => a.orderIndex - b.orderIndex)
              .map((pe, i) => (
                <div key={pe.id} className={libStyles.detailExerciseRow}>
                  <span className={libStyles.detailExerciseIndex}>{i + 1}</span>
                  <span className={libStyles.detailExerciseName}>{pe.exerciseName ?? "Упражнение"}</span>
                </div>
              ))}
          </div>
        )}

        <div>
          <span className={libStyles.detailSharedLabel}>Показано командам</span>
          <div className={libStyles.detailSharedRow} style={{ marginTop: 8 }}>
            {sharedTeams.map((t) => (
              <span key={t.id} className={libStyles.detailSharedChip}>
                {t.name}
              </span>
            ))}
            {unsharedTeams.length > 0 && (
              <button type="button" className={libStyles.detailAddTeamChip} onClick={() => setTeamOpen((v) => !v)}>
                + команда
              </button>
            )}
          </div>
          {teamOpen && (
            <div className={libStyles.detailDropdown} style={{ marginTop: 6 }}>
              {unsharedTeams.map((t) => (
                <button key={t.id} type="button" className={libStyles.detailDropdownItem} disabled={busy} onClick={() => void handleShare(t.id)}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className={profileStyles.error}>{error}</p>}

        <div className={libStyles.detailActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleDuplicate()} disabled={dupBusy}>
            {dupBusy ? "Дублирую…" : "Дублировать"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onEdit}>
            Изменить
          </button>
        </div>
        <button type="button" className={libStyles.detailAddTeamChip} style={{ alignSelf: "center" }} onClick={onOpenFull}>
          Подробнее →
        </button>
      </div>
    </div>
  );
}

export function PlansScreen({ token }: { token: string }) {
  const isDesktop = useIsDesktop();
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [teams, setTeams] = useState<Team[]>([]);
  const [query, setQuery] = useState("");
  const [sportFilter, setSportFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(() => {
    setState({ status: "loading" });
    Promise.all([listMyPlans(token), listMyTeams(token).catch(() => [])])
      .then(([plans, teamsList]) => {
        setState({ status: "ready", plans });
        setTeams(teamsList);
      })
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

  const sports = Array.from(new Set(state.plans.map((p) => p.sport))).sort((a, b) => a.localeCompare(b, "ru"));

  const filteredPlans = state.plans.filter((plan) => {
    const q = query.trim().toLowerCase();
    if (q && !plan.name.toLowerCase().includes(q) && !plan.sport.toLowerCase().includes(q)) return false;
    if (sportFilter && plan.sport !== sportFilter) return false;
    return true;
  });

  const selected = filteredPlans.find((p) => p.id === selectedId) ?? filteredPlans[0] ?? null;

  return (
    <div className={styles.screen}>
      <div className={styles.headerRow}>
        <h1 className={styles.heading}>Планы тренировок</h1>
        <button type="button" className={styles.addButton} onClick={() => setView({ screen: "create" })}>
          <Icon name="plus" size={16} />
          Создать
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
      ) : (
        <>
          <div className={libStyles.toolbarRow}>
            <button type="button" className={sportFilter === "" ? libStyles.sportChipActive : libStyles.sportChip} onClick={() => setSportFilter("")}>
              Все
            </button>
            {sports.map((sport) => (
              <button
                key={sport}
                type="button"
                className={sportFilter === sport ? libStyles.sportChipActive : libStyles.sportChip}
                onClick={() => setSportFilter(sport)}
              >
                {sport}
              </button>
            ))}
            <span className={libStyles.resultCount}>{filteredPlans.length} планов</span>
          </div>

          {filteredPlans.length === 0 ? (
            <StateScreen kind="empty" title="Ничего не найдено" description="Попробуйте изменить запрос или фильтр." />
          ) : (
            <div className={libStyles.libraryLayout}>
              <div className={libStyles.libraryMain}>
                <div className={libStyles.exerciseGrid}>
                  {filteredPlans.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      className={libStyles.libCard}
                      onClick={() => (isDesktop ? setSelectedId(plan.id) : setView({ screen: "detail", planId: plan.id }))}
                    >
                      <span className={libStyles.libCardIcon}>
                        <Icon name="clipboard" size={19} />
                      </span>
                      <h2 className={libStyles.libCardTitle}>{plan.name}</h2>
                      <p className={libStyles.libCardMeta}>
                        {plan.sport}
                        {plan.durationMinutes !== null ? ` · ${plan.durationMinutes} мин` : ""}
                      </p>
                      <div className={libStyles.libCardFooter}>
                        <span>{plan.exercises.length} упражнений</span>
                        <span>{plan.sharedTeamIds.length > 0 ? `${plan.sharedTeamIds.length} команд` : "личное"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {isDesktop && selected && (
                <PlanDetailPanel
                  token={token}
                  plan={selected}
                  teams={teams}
                  onEdit={() => setView({ screen: "edit", plan: selected })}
                  onOpenFull={() => setView({ screen: "detail", planId: selected.id })}
                  onChanged={load}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

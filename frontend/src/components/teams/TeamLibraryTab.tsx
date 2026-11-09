import { useCallback, useEffect, useState } from "react";
import { listMyExercises, listTeamExercises, shareExercise, unshareExercise } from "../../api/exercises";
import { listMyPlans, listTeamPlans, sharePlan, unsharePlan } from "../../api/plans";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { ExerciseDetail } from "../library/ExerciseDetail";
import { PlanDetail } from "../library/PlanDetail";
import type { Exercise } from "../../types/exercise";
import type { Plan } from "../../types/plan";
import profileStyles from "../profile/profile.module.css";
import styles from "./teams.module.css";

type Kind = "exercises" | "plans";
type Item = { id: string; name: string; sport: string; sharedTeamIds: string[] };
type View = { screen: "list" } | { screen: "share" } | { screen: "exercise"; id: string } | { screen: "plan"; id: string };

const asItem = (value: Exercise | Plan): Item => ({ id: value.id, name: value.name, sport: value.sport, sharedTeamIds: value.sharedTeamIds });

/** «Упражнения и планы» of a team: what the coach opened to it. The coach also opens more from here, without going to the library. */
export function TeamLibraryTab({ token, teamId, teamName, canManage }: { token: string; teamId: string; teamName: string; canManage: boolean }) {
  const [kind, setKind] = useState<Kind>("exercises");
  const [view, setView] = useState<View>({ screen: "list" });
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setItems(null);
    setError(null);
    const request = kind === "exercises" ? listTeamExercises(token, teamId) : listTeamPlans(token, teamId);
    request
      .then((list) => setItems(list.map(asItem)))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить материалы"));
  }, [token, teamId, kind]);

  useEffect(() => {
    if (view.screen === "list") load();
  }, [view, load]);

  if (view.screen === "exercise") {
    return <ExerciseDetail token={token} exerciseId={view.id} isOwner={false} onBack={() => setView({ screen: "list" })} onEdit={() => undefined} onDeleted={() => setView({ screen: "list" })} />;
  }
  if (view.screen === "plan") {
    return <PlanDetail token={token} planId={view.id} isOwner={false} onBack={() => setView({ screen: "list" })} />;
  }
  if (view.screen === "share") {
    return <ShareList token={token} teamId={teamId} teamName={teamName} kind={kind} onDone={() => setView({ screen: "list" })} />;
  }

  const noun = kind === "exercises" ? "упражнения" : "планы";
  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button type="button" className={kind === "exercises" ? styles.realTabActive : styles.realTab} onClick={() => setKind("exercises")}>
          Упражнения
        </button>
        <button type="button" className={kind === "plans" ? styles.realTabActive : styles.realTab} onClick={() => setKind("plans")}>
          Планы
        </button>
      </div>

      {canManage && (
        <button type="button" className={styles.addButton} style={{ width: "100%", marginBottom: 8 }} onClick={() => setView({ screen: "share" })}>
          <Icon name="plus" size={16} />
          Открыть команде {noun}
        </button>
      )}

      {error && <StateScreen kind="error" title="Не удалось загрузить" description={error} onRetry={load} />}
      {!error && items === null && <StateScreen kind="loading" title="Загрузка…" />}
      {items?.length === 0 && (
        <StateScreen
          kind="empty"
          title={kind === "exercises" ? "Упражнений нет" : "Планов нет"}
          description={
            canManage
              ? `Откройте команде свои ${noun} кнопкой выше — игроки увидят их здесь.`
              : `Тренер ещё не открыл команде ни одного ${kind === "exercises" ? "упражнения" : "плана"}.`
          }
        />
      )}
      {items?.map((item) => (
        <button
          key={item.id}
          type="button"
          className={styles.teamCard}
          onClick={() => setView({ screen: kind === "exercises" ? "exercise" : "plan", id: item.id })}
        >
          <div className={styles.teamCardTop}>
            <h2 className={styles.teamName}>{item.name}</h2>
            <span className={styles.chevron} aria-hidden="true">
              <Icon name="chevron-right" size={18} />
            </span>
          </div>
          <p className={styles.teamMeta}>{item.sport}</p>
        </button>
      ))}
    </>
  );
}

/** The coach's own exercises or plans with a switch for each: open to this team or not. */
function ShareList({ token, teamId, teamName, kind, onDone }: { token: string; teamId: string; teamName: string; kind: Kind; onDone: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const request = kind === "exercises" ? listMyExercises(token) : listMyPlans(token);
    request
      .then((list) => setItems(list.map(asItem)))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Не удалось загрузить библиотеку"));
  }, [token, kind]);

  const toggle = async (item: Item, on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const updated =
        kind === "exercises"
          ? on ? await shareExercise(token, item.id, teamId) : await unshareExercise(token, item.id, teamId)
          : on ? await sharePlan(token, item.id, teamId) : await unsharePlan(token, item.id, teamId);
      setItems((prev) => prev?.map((other) => (other.id === item.id ? asItem(updated) : other)) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось изменить доступ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={profileStyles.card}>
      <h2 className={profileStyles.title}>{kind === "exercises" ? "Открыть команде упражнения" : "Открыть команде планы"}</h2>
      <p className={profileStyles.subtitle}>Включённое увидят все участники команды «{teamName}» в разделе «Упражнения и планы».</p>
      {items === null && !error && <p className={profileStyles.subtitle}>Загрузка…</p>}
      {items?.length === 0 && <p className={profileStyles.subtitle}>В вашей библиотеке пока нет {kind === "exercises" ? "упражнений" : "планов"}. Создайте их во вкладке «Библиотека».</p>}
      {items?.map((item) => (
        <label key={item.id} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, padding: "6px 0" }}>
          <input type="checkbox" checked={item.sharedTeamIds.includes(teamId)} disabled={busy} onChange={(e) => void toggle(item, e.target.checked)} />
          <span>{item.name}</span>
        </label>
      ))}
      {error && <p className={profileStyles.error}>{error}</p>}
      <button type="button" className={profileStyles.buttonSecondary} onClick={onDone}>
        Готово
      </button>
    </div>
  );
}

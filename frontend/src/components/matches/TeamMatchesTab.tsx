import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { listTeamMatches } from "../../api/matches";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { Icon } from "../shared/Icon";
import { MatchForm } from "./MatchForm";
import { MatchDetail } from "./MatchDetail";
import { MATCH_RESULT_LABELS, MATCH_STATUS_LABELS, type Match, type MatchResult } from "../../types/match";
import styles from "../teams/teams.module.css";

type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; matches: Match[] };

const MATCH_CARD_COLORS: Record<MatchResult | "scheduled" | "cancelled", string> = {
  win: "var(--color-success)",
  loss: "var(--color-danger)",
  draw: "var(--color-warning)",
  scheduled: "var(--color-primary)",
  cancelled: "var(--color-text-tertiary)",
};

function matchCardColor(match: Match): string {
  if (match.result) return MATCH_CARD_COLORS[match.result];
  if (match.status === "cancelled") return MATCH_CARD_COLORS.cancelled;
  return MATCH_CARD_COLORS.scheduled;
}

type View = { screen: "list" } | { screen: "create" } | { screen: "edit"; match: Match } | { screen: "detail"; matchId: string };

export function TeamMatchesTab({ token, teamId, canManage }: { token: string; teamId: string; canManage: boolean }) {
  const [view, setView] = useState<View>({ screen: "list" });
  const [state, setState] = useState<ListState>({ status: "loading" });

  const load = useCallback(() => {
    setState({ status: "loading" });
    listTeamMatches(token, teamId)
      .then((matches) => setState({ status: "ready", matches }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось загрузить матчи";
        setState({ status: "error", message });
      });
  }, [token, teamId]);

  useEffect(() => {
    if (view.screen === "list") load();
  }, [view, load]);

  if (view.screen === "create") {
    return (
      <MatchForm token={token} teamId={teamId} onSaved={(match) => setView({ screen: "detail", matchId: match.id })} onCancel={() => setView({ screen: "list" })} />
    );
  }

  if (view.screen === "edit") {
    return (
      <MatchForm
        token={token}
        teamId={teamId}
        initial={view.match}
        onSaved={(match) => setView({ screen: "detail", matchId: match.id })}
        onCancel={() => setView({ screen: "detail", matchId: view.match.id })}
      />
    );
  }

  if (view.screen === "detail") {
    return (
      <MatchDetail
        token={token}
        matchId={view.matchId}
        canManage={canManage}
        onBack={() => setView({ screen: "list" })}
        onEdit={(match) => setView({ screen: "edit", match })}
        onDeleted={() => setView({ screen: "list" })}
      />
    );
  }

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка матчей…" />;
  }
  if (state.status === "error") {
    return <StateScreen kind="error" title="Не удалось загрузить матчи" description={state.message} onRetry={load} />;
  }

  return (
    <>
      {canManage && (
        <button type="button" className={styles.addButton} onClick={() => setView({ screen: "create" })} style={{ marginBottom: 4 }}>
          <Icon name="plus" size={16} />
          Новый матч
        </button>
      )}

      {state.matches.length === 0 ? (
        <StateScreen kind="empty" title="Пока нет матчей" description={canManage ? "Запланируйте первый матч команды." : "Тренер ещё не запланировал матчи."} />
      ) : (
        state.matches.map((match) => (
          <button
            key={match.id}
            type="button"
            className={styles.teamCard}
            style={{ "--event-color": matchCardColor(match) } as CSSProperties}
            onClick={() => setView({ screen: "detail", matchId: match.id })}
          >
            <div className={styles.teamCardTop}>
              <h2 className={styles.teamName}>{match.opponentName}</h2>
              <span className={styles.badge}>{match.result ? MATCH_RESULT_LABELS[match.result] : MATCH_STATUS_LABELS[match.status]}</span>
              <span className={styles.chevron} aria-hidden="true">
                <Icon name="chevron-right" size={18} />
              </span>
            </div>
            <p className={styles.teamMeta}>
              {match.matchDate} · {match.startTime.slice(0, 5)} · {match.isHome ? "дома" : "в гостях"}
            </p>
          </button>
        ))
      )}
    </>
  );
}

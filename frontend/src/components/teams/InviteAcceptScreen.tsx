import { useEffect, useState } from "react";
import { applyViaInvite, previewInvite } from "../../api/teams";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { SKILL_LEVEL_LABELS } from "../../types/profile";
import type { Team } from "../../types/team";
import profileStyles from "../profile/profile.module.css";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "preview"; team: Team }
  | { status: "applying"; team: Team }
  | { status: "done"; team: Team; result: "pending" | "joined" };

export function InviteAcceptScreen({
  token,
  inviteToken,
  onDone,
}: {
  token: string;
  inviteToken: string;
  onDone: () => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = () => {
    setState({ status: "loading" });
    previewInvite(token, inviteToken)
      .then((team) => setState({ status: "preview", team }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Не удалось открыть приглашение";
        setState({ status: "error", message });
      });
  };

  useEffect(load, [token, inviteToken]);

  if (state.status === "loading") {
    return <StateScreen kind="loading" title="Загрузка приглашения…" />;
  }

  if (state.status === "error") {
    return <StateScreen kind="error" title="Приглашение недоступно" description={state.message} onRetry={load} />;
  }

  if (state.status === "done") {
    return (
      <div className={profileStyles.screen}>
        <div className={profileStyles.card}>
          <h1 className={profileStyles.title}>
            {state.result === "joined" ? "Вы присоединились к команде!" : "Заявка отправлена"}
          </h1>
          <p className={profileStyles.subtitle}>
            {state.result === "joined"
              ? `Теперь вы основной тренер команды «${state.team.name}».`
              : `Тренер команды «${state.team.name}» рассмотрит вашу заявку.`}
          </p>
          <button type="button" className={profileStyles.buttonPrimary} onClick={onDone}>
            Готово
          </button>
        </div>
      </div>
    );
  }

  const { team } = state;
  const applying = state.status === "applying";

  const handleApply = async () => {
    setState({ status: "applying", team });
    try {
      const result = await applyViaInvite(token, inviteToken);
      setState({ status: "done", team: result.team, result: result.status });
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Не удалось отправить заявку";
      setState({ status: "error", message });
    }
  };

  if (team.myRole) {
    return (
      <div className={profileStyles.screen}>
        <div className={profileStyles.card}>
          <h1 className={profileStyles.title}>Вы уже в этой команде</h1>
          <button type="button" className={profileStyles.buttonPrimary} onClick={onDone}>
            Готово
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={profileStyles.screen}>
      <div className={profileStyles.card}>
        <h1 className={profileStyles.title}>{team.name}</h1>
        {team.description && <p className={profileStyles.subtitle}>{team.description}</p>}
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Вид спорта</span>
          <span className={profileStyles.rowValue}>{team.sport}</span>
        </div>
        {team.ageCategory && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Возрастная категория</span>
            <span className={profileStyles.rowValue}>{team.ageCategory}</span>
          </div>
        )}
        {team.level && (
          <div className={profileStyles.row}>
            <span className={profileStyles.rowLabel}>Уровень</span>
            <span className={profileStyles.rowValue}>{SKILL_LEVEL_LABELS[team.level]}</span>
          </div>
        )}
        <div className={profileStyles.row}>
          <span className={profileStyles.rowLabel}>Участников</span>
          <span className={profileStyles.rowValue}>{team.membersCount} / 50</span>
        </div>

        <div className={profileStyles.formActions}>
          <button type="button" className={profileStyles.buttonPrimary} onClick={() => void handleApply()} disabled={applying}>
            {applying
              ? "Отправка…"
              : team.status === "without_coach"
                ? "Стать основным тренером"
                : "Подать заявку на вступление"}
          </button>
          <button type="button" className={profileStyles.buttonSecondary} onClick={onDone} disabled={applying}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}

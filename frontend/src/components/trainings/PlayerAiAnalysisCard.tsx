import { useCallback, useEffect, useState } from "react";
import {
  analyzePersonalTrainingPlayer,
  getPersonalTrainingPlayerAnalysis,
  type PlayerPreSessionAnalysis,
} from "../../api/ai";
import { ApiError } from "../../api/client";
import { Icon } from "../shared/Icon";
import profileStyles from "../profile/profile.module.css";
import aiStyles from "../stats/stats.module.css";
import styles from "./playerAnalysis.module.css";

type Access =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "denied" } // the player has not allowed AI analysis
  | { kind: "allowed"; analysis: PlayerPreSessionAnalysis | null };

function BulletSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <ul className={styles.list}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AnalysisResult({ analysis }: { analysis: PlayerPreSessionAnalysis }) {
  const generated = new Date(analysis.generatedAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className={styles.result}>
      {analysis.dataSufficiency !== "sufficient" && (
        <div className={styles.notice}>
          {analysis.dataSufficiency === "insufficient"
            ? "Недостаточно данных: об игроке почти ничего не известно, поэтому рекомендации общие."
            : "Данных об игроке пока немного — выводы осторожные."}
          {analysis.dataNotes ? ` ${analysis.dataNotes}` : ""}
        </div>
      )}
      {analysis.dataSufficiency === "sufficient" && analysis.dataNotes && <div className={styles.notice}>{analysis.dataNotes}</div>}

      {analysis.summary && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Краткий анализ игрока</h3>
          <p className={styles.text}>{analysis.summary}</p>
        </div>
      )}
      <BulletSection title="Сильные стороны" items={analysis.strengths} />
      <BulletSection title="На что стоит обратить внимание" items={analysis.attentionPoints} />
      <BulletSection title="Последняя динамика" items={analysis.recentDynamics} />
      <BulletSection title="Рекомендации к предстоящей тренировке" items={analysis.recommendations} />
      {analysis.sessionFocus && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Предлагаемый акцент занятия</h3>
          <p className={styles.text}>{analysis.sessionFocus}</p>
        </div>
      )}
      {analysis.sessionPlan.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Возможная структура занятия</h3>
          <ol className={styles.steps}>
            {analysis.sessionPlan.map((step, i) => (
              <li key={i}>
                <span className={styles.stepStage}>{step.stage}.</span> {step.description}
                {step.exerciseName && (
                  <span className={styles.libraryBadge}>
                    <Icon name="book" size={12} />
                    Из вашей библиотеки: {step.exerciseName}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
      <p className={styles.meta}>
        Сформировано {generated}. Это подсказка на основе доступных данных, а не окончательная характеристика игрока.
      </p>
    </div>
  );
}

/** Coach-only "prepare for the session" block on a personal training. Shows
 * the action, the "player did not allow it" notice, or the saved result. All
 * authorization is enforced by the backend; this only reflects its answer. */
export function PlayerAiAnalysisCard({ token, trainingId }: { token: string; trainingId: string }) {
  const [access, setAccess] = useState<Access>({ kind: "loading" });
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(() => {
    setAccess({ kind: "loading" });
    getPersonalTrainingPlayerAnalysis(token, trainingId)
      .then((status) => setAccess(status.allowed ? { kind: "allowed", analysis: status.analysis } : { kind: "denied" }))
      .catch((err: unknown) =>
        setAccess({ kind: "error", message: err instanceof ApiError ? err.message : "Не удалось проверить доступ к AI-анализу" }),
      );
  }, [token, trainingId]);

  useEffect(load, [load]);

  const run = async () => {
    if (running) return;
    setRunning(true);
    setRunError(null);
    try {
      const analysis = await analyzePersonalTrainingPlayer(token, trainingId);
      setAccess({ kind: "allowed", analysis });
    } catch (err) {
      if (err instanceof ApiError && err.code === "player_ai_analysis_disabled") {
        // The player withdrew consent while this screen was open.
        setAccess({ kind: "denied" });
      } else {
        setRunError(err instanceof ApiError ? err.message : "Не удалось получить анализ. Попробуйте ещё раз.");
      }
    } finally {
      setRunning(false);
    }
  };

  if (access.kind === "loading") {
    return (
      <div className={aiStyles.aiCard} aria-busy="true">
        <div className={aiStyles.aiCardHead}>
          <Icon name="sparkles" size={18} />
          <span className={aiStyles.aiCardTitle}>AI-анализ игрока</span>
        </div>
        <p className={profileStyles.subtitle} style={{ margin: 0 }}>
          Проверяю доступ…
        </p>
      </div>
    );
  }

  if (access.kind === "denied") {
    return (
      <div className={profileStyles.card}>
        <div className={styles.lockHead}>
          <Icon name="lock" size={18} />
          <h2 className={profileStyles.title} style={{ margin: 0 }}>
            AI-анализ недоступен
          </h2>
        </div>
        <p className={profileStyles.subtitle} style={{ margin: 0 }}>
          Игрок не разрешил использовать свои спортивные данные для AI-анализа.
        </p>
      </div>
    );
  }

  if (access.kind === "error") {
    return (
      <div className={profileStyles.card}>
        <h2 className={profileStyles.title}>AI-анализ игрока</h2>
        <p className={profileStyles.error}>{access.message}</p>
        <button type="button" className={profileStyles.buttonSecondary} onClick={load}>
          Повторить
        </button>
      </div>
    );
  }

  const { analysis } = access;
  return (
    <div className={aiStyles.aiCard}>
      <div className={aiStyles.aiCardHead}>
        <Icon name="sparkles" size={18} />
        <span className={aiStyles.aiCardTitle}>AI-анализ игрока</span>
      </div>
      <p className={profileStyles.subtitle} style={{ margin: 0 }}>
        AI изучит доступные данные игрока и поможет подготовиться к предстоящей тренировке.
      </p>
      {running && (
        <p className={styles.progress} role="status">
          Анализирую данные игрока — это может занять до минуты…
        </p>
      )}
      {runError && <p className={profileStyles.error}>{runError}</p>}
      <button type="button" className={profileStyles.buttonPrimary} onClick={() => void run()} disabled={running}>
        {running ? "Анализирую…" : analysis ? "Обновить анализ" : "Проанализировать игрока"}
      </button>
      {analysis && <AnalysisResult analysis={analysis} />}
    </div>
  );
}

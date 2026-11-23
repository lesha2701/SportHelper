import { useCallback, useEffect, useState } from "react";
import {
  acceptCoachOffer,
  declineCoachOffer,
  getMatchOfferSettings,
  listCoachOffers,
  saveMatchOfferSettings,
  type CoachOffer,
  type CoachOfferStatus,
  type MatchOfferSettings,
} from "../../api/matchOffers";
import { budgetText, MATCH_FORMAT_LABELS, MATCH_LEVEL_LABELS, whenText } from "../../api/matchRequests";
import { ApiError } from "../../api/client";
import { StateScreen } from "../StateScreen";
import { TitleWithBack } from "../shared/BackArrow";
import profileStyles from "../profile/profile.module.css";
import styles from "./matchRequest.module.css";

const STATUS_LABELS: Record<CoachOfferStatus, string> = {
  proposed: "Ждёт вашего ответа",
  coach_accepted: "Вы согласились",
  coach_declined: "Вы отказались",
  athlete_accepted: "Спортсмен выбрал вас",
  athlete_declined: "Спортсмен выбрал другое",
  withdrawn: "Закрыто",
  expired: "Время вышло",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** «Подбор клиентов» (a trainer's side of «Подобрать тренера»): the consent with its terms, and the offers of the administrators.
 *  The athlete's name and contacts are not shown: the trainer sees only the request. */
export function MatchOffersScreen({ onBack }: { onBack: () => void }) {
  const [settings, setSettings] = useState<MatchOfferSettings | null>(null);
  const [offers, setOffers] = useState<CoachOffer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(() => {
    setLoadError(null);
    Promise.all([getMatchOfferSettings(), listCoachOffers()])
      .then(([s, o]) => {
        setSettings(s);
        setOffers(o);
      })
      .catch((err: unknown) => setLoadError(err instanceof ApiError ? err.message : "Не удалось загрузить"));
  }, []);
  useEffect(load, [load]);

  if (loadError) return <StateScreen kind="error" title="Не удалось загрузить" description={loadError} onRetry={load} />;
  if (!settings) return <StateScreen kind="loading" title="Загрузка…" />;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await saveMatchOfferSettings(!settings.enabled, settings.enabled ? null : settings.currentVersion));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось сохранить");
      load();
    } finally {
      setBusy(false);
    }
  };

  const replace = (updated: CoachOffer) => setOffers((list) => list.map((o) => (o.id === updated.id ? updated : o)));

  const answer = async (offer: CoachOffer, accept: boolean) => {
    setBusy(true);
    setError(null);
    try {
      replace(accept ? await acceptCoachOffer(offer.id) : await declineCoachOffer(offer.id, reason.trim() || null));
      setDeclining(null);
      setReason("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось ответить");
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={profileStyles.screen}>
      <div className={profileStyles.card}>
        <TitleWithBack onBack={onBack}>
          <h1 className={profileStyles.pageHeading}>Подбор клиентов</h1>
        </TitleWithBack>

        <div className={styles.terms}>
          <h2 className={styles.sectionTitle}>{settings.termsTitle}</h2>
          {settings.terms.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>

        <label className={styles.switchRow}>
          <input type="checkbox" role="switch" checked={settings.enabled} disabled={busy} onChange={() => void toggle()} />
          {settings.enabled ? "Меня можно рекомендовать" : "Принять условия и включить подбор"}
        </label>
        {!settings.termsAccepted && settings.acceptedVersion && (
          <p className={profileStyles.subtitle}>Условия обновились: чтобы получать предложения, включите подбор заново.</p>
        )}
        {error && <p className={profileStyles.error}>{error}</p>}
      </div>

      <div className={profileStyles.card}>
        <h2 className={styles.sectionTitle}>Предложения</h2>
        {offers.length === 0 ? (
          <p className={profileStyles.subtitle}>Предложений пока нет. Когда мы подберём вам клиента, он появится здесь.</p>
        ) : (
          <ul className={styles.list}>
            {offers.map((offer) => (
              <OfferItem
                key={offer.id}
                offer={offer}
                busy={busy}
                declining={declining === offer.id}
                reason={reason}
                onReason={setReason}
                onAccept={() => void answer(offer, true)}
                onStartDecline={() => {
                  setDeclining(offer.id);
                  setReason("");
                }}
                onCancelDecline={() => setDeclining(null)}
                onDecline={() => void answer(offer, false)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function OfferItem({
  offer,
  busy,
  declining,
  reason,
  onReason,
  onAccept,
  onStartDecline,
  onCancelDecline,
  onDecline,
}: {
  offer: CoachOffer;
  busy: boolean;
  declining: boolean;
  reason: string;
  onReason: (text: string) => void;
  onAccept: () => void;
  onStartDecline: () => void;
  onCancelDecline: () => void;
  onDecline: () => void;
}) {
  const r = offer.request;
  const facts: [string, string | null][] = [
    ["Цель", r.goal],
    ["Уровень", r.level ? MATCH_LEVEL_LABELS[r.level] : null],
    ["Формат", r.format ? MATCH_FORMAT_LABELS[r.format] : null],
    ["Город", r.city],
    ["Бюджет", budgetText(r.budgetMin, r.budgetMax, r.currency)],
    ["Когда удобно", [whenText(r.weekdays, r.dayParts), r.scheduleNote].filter(Boolean).join(" · ") || null],
    ["Комментарий", r.comment],
    ["От нас", offer.adminMessage],
  ];
  const waiting = offer.status === "proposed";
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <div>
          <strong>{r.sport}</strong>
          <div className={styles.hint}>Получено {formatWhen(offer.createdAt)}</div>
        </div>
        <span className={styles.badge}>{STATUS_LABELS[offer.status]}</span>
      </div>
      <dl className={styles.facts}>
        {facts
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {waiting && (
        <>
          <p className={styles.hint}>
            За первую тренировку с этим клиентом платформа удерживает {offer.firstSessionPercent}% вместо обычной комиссии — это разово. Имя и
            контакты клиента откроются после его выбора и оплаты. Ответьте до {formatWhen(offer.expiresAt)}.
          </p>
          {declining ? (
            <>
              <textarea
                className={profileStyles.input}
                rows={2}
                maxLength={500}
                placeholder="Причина (необязательно)"
                value={reason}
                onChange={(e) => onReason(e.target.value)}
              />
              <div className={styles.offerActions}>
                <button type="button" className={profileStyles.buttonSecondary} disabled={busy} onClick={onDecline}>
                  Отказаться
                </button>
                <button type="button" className={styles.link} onClick={onCancelDecline}>
                  Назад
                </button>
              </div>
            </>
          ) : (
            <div className={styles.offerActions}>
              <button type="button" className={profileStyles.buttonPrimary} disabled={busy} onClick={onAccept}>
                Принять клиента
              </button>
              <button type="button" className={styles.link} onClick={onStartDecline}>
                Отказаться
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  acceptMatchOffer,
  budgetText,
  cancelMatchRequest,
  declineMatchOffer,
  createMatchRequest,
  DAY_PART_LABELS,
  listMyMatchRequests,
  MATCH_FORMAT_LABELS,
  MATCH_LEVEL_LABELS,
  MATCH_STATUS_LABELS,
  WEEKDAY_LABELS,
  whenText,
  type DayPart,
  type MatchFormat,
  type MatchLevel,
  type MatchOffer,
  type MatchRequest,
} from "../../api/matchRequests";
import { ApiError } from "../../api/client";
import profileStyles from "../profile/profile.module.css";
import styles from "./matchRequest.module.css";

const LEVELS = Object.keys(MATCH_LEVEL_LABELS) as MatchLevel[];
const FORMATS = Object.keys(MATCH_FORMAT_LABELS) as MatchFormat[];
const DAY_PARTS = Object.keys(DAY_PART_LABELS) as DayPart[];
const SPORT_MAX = 100;
const GOAL_MAX = 1000;
const COMMENT_MAX = 1500;
const NOTE_MAX = 500;
const CITY_MAX = 100;

const orNull = (value: string): string | null => value.trim().replace(/[ \t]+/g, " ") || null;

/** Digits only (spaces are allowed as thousands separators); an empty field is «no limit». */
function parseMoney(text: string): number | null | "bad" {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  if (clean === "") return null;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(clean)) return "bad";
  return Number(clean);
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/** «Подобрать тренера»: the person says what they are looking for (only the sport is required: the more is filled in, the better the
 *  match), the administrators pick trainers. The person's contacts are not given to anybody. */
export function MatchRequestScreen({
  guest = false,
  onRequireLogin,
  onOpenCoach,
}: {
  guest?: boolean;
  onRequireLogin?: () => void;
  onOpenCoach?: (coachUserId: string) => void;
}) {
  const [sport, setSport] = useState("");
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState<MatchLevel | null>(null);
  const [format, setFormat] = useState<MatchFormat | null>(null);
  const [city, setCity] = useState("");
  const [minText, setMinText] = useState("");
  const [maxText, setMaxText] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [dayParts, setDayParts] = useState<DayPart[]>([]);
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState<MatchRequest[] | null>(null);
  const [mineFailed, setMineFailed] = useState(false);

  const loadMine = useCallback(() => {
    if (guest) return;
    listMyMatchRequests()
      .then((items) => {
        setMine(items);
        setMineFailed(false);
      })
      .catch(() => setMineFailed(true));
  }, [guest]);
  useEffect(loadMine, [loadMine]);

  if (guest) {
    return (
      <div className={profileStyles.card}>
        <h2 className={styles.sectionTitle}>Подобрать тренера</h2>
        <p className={profileStyles.subtitle}>
          Расскажите, что вы хотите прокачать, — мы подберём тренеров и предложим вам лучших из тех, кто участвует в подборе. Чтобы отправить заявку,
          войдите в аккаунт.
        </p>
        <button type="button" className={profileStyles.buttonPrimary} onClick={onRequireLogin}>
          Войти
        </button>
      </div>
    );
  }

  const min = parseMoney(minText);
  const max = parseMoney(maxText);
  const budgetProblem =
    min === "bad" || max === "bad"
      ? "Бюджет: только цифры."
      : min !== null && max !== null && min > max
        ? "Бюджет «от» не может быть больше бюджета «до»."
        : null;
  const cleanSport = sport.trim().replace(/\s+/g, " ");
  const valid = cleanSport.length >= 2 && !budgetProblem;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || sending) return;
    setSending(true);
    setError(null);
    try {
      await createMatchRequest({
        sport: cleanSport,
        goal: orNull(goal),
        level,
        format,
        city: orNull(city),
        budgetMin: min === "bad" ? null : min,
        budgetMax: max === "bad" ? null : max,
        weekdays: [...weekdays].sort(),
        dayParts,
        scheduleNote: orNull(note),
        comment: orNull(comment),
      });
      setSent(true);
      setSport("");
      setGoal("");
      setLevel(null);
      setFormat(null);
      setCity("");
      setMinText("");
      setMaxText("");
      setWeekdays([]);
      setDayParts([]);
      setNote("");
      setComment("");
      loadMine();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить заявку. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  };

  const withdraw = async (id: string) => {
    try {
      const updated = await cancelMatchRequest(id);
      setMine((list) => list && list.map((x) => (x.id === id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отозвать заявку.");
    }
  };

  const answer = async (offerId: string, accept: boolean) => {
    setError(null);
    try {
      const updated = await (accept ? acceptMatchOffer(offerId) : declineMatchOffer(offerId));
      setMine((list) => list && list.map((x) => (x.id === updated.id ? updated : x)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось ответить. Попробуйте ещё раз.");
      loadMine();
    }
  };

  return (
    <>
      <div className={profileStyles.card}>
        <h2 className={styles.sectionTitle}>Подобрать тренера</h2>
        <p className={profileStyles.subtitle}>
          Не нашли нужного тренера в каталоге? Расскажите, что вы ищете, — мы подберём тренеров и предложим вам подходящих. Обязателен только вид
          спорта: чем больше вы заполните, тем точнее будет подбор. Ваши контакты тренерам не передаются.
        </p>
      </div>

      {sent ? (
        <div className={profileStyles.card} role="status">
          <h2 className={styles.sectionTitle}>Спасибо! Заявка отправлена</h2>
          <p className={profileStyles.subtitle}>Мы изучим её и вернёмся с вариантами. Статус заявки виден ниже.</p>
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => setSent(false)}>
            Отправить ещё одну
          </button>
        </div>
      ) : (
        <form className={profileStyles.card} onSubmit={submit}>
          <p className={profileStyles.requiredHint}>Поле со звёздочкой (*) обязательно. Остальные — по желанию.</p>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>
              Вид спорта<span className={profileStyles.requiredMark}>*</span>
            </span>
            <input className={profileStyles.input} value={sport} maxLength={SPORT_MAX} placeholder="Например: теннис" onChange={(e) => setSport(e.target.value)} disabled={sending} />
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Что хотите прокачать</span>
            <textarea
              className={profileStyles.textarea}
              rows={3}
              value={goal}
              maxLength={GOAL_MAX}
              placeholder="Цель: подача, выносливость, подготовка к соревнованиям…"
              onChange={(e) => setGoal(e.target.value)}
              disabled={sending}
            />
          </label>

          <fieldset className={styles.group}>
            <legend className={profileStyles.label}>Ваш уровень</legend>
            <div className={styles.chips}>
              {LEVELS.map((l) => (
                <button key={l} type="button" className={level === l ? `${styles.chip} ${styles.chipOn}` : styles.chip} aria-pressed={level === l} onClick={() => setLevel(level === l ? null : l)} disabled={sending}>
                  {MATCH_LEVEL_LABELS[l]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={profileStyles.label}>Формат занятий</legend>
            <div className={styles.chips}>
              {FORMATS.map((f) => (
                <button key={f} type="button" className={format === f ? `${styles.chip} ${styles.chipOn}` : styles.chip} aria-pressed={format === f} onClick={() => setFormat(format === f ? null : f)} disabled={sending}>
                  {MATCH_FORMAT_LABELS[f]}
                </button>
              ))}
            </div>
          </fieldset>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Город</span>
            <input className={profileStyles.input} value={city} maxLength={CITY_MAX} placeholder="Где удобно заниматься очно" onChange={(e) => setCity(e.target.value)} disabled={sending} />
          </label>

          <fieldset className={styles.group}>
            <legend className={profileStyles.label}>Бюджет за одно занятие, ₽</legend>
            <div className={styles.pair}>
              <input className={profileStyles.input} inputMode="numeric" value={minText} placeholder="От" aria-label="Бюджет от" onChange={(e) => setMinText(e.target.value)} disabled={sending} />
              <input className={profileStyles.input} inputMode="numeric" value={maxText} placeholder="До" aria-label="Бюджет до" onChange={(e) => setMaxText(e.target.value)} disabled={sending} />
            </div>
            {budgetProblem && <p className={profileStyles.error}>{budgetProblem}</p>}
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={profileStyles.label}>В какие дни можете заниматься</legend>
            <div className={styles.chips}>
              {WEEKDAY_LABELS.map((label, day) => (
                <button key={label} type="button" className={weekdays.includes(day) ? `${styles.chip} ${styles.chipOn}` : styles.chip} aria-pressed={weekdays.includes(day)} onClick={() => setWeekdays(toggle(weekdays, day))} disabled={sending}>
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend className={profileStyles.label}>В какое время суток</legend>
            <div className={styles.chips}>
              {DAY_PARTS.map((p) => (
                <button key={p} type="button" className={dayParts.includes(p) ? `${styles.chip} ${styles.chipOn}` : styles.chip} aria-pressed={dayParts.includes(p)} onClick={() => setDayParts(toggle(dayParts, p))} disabled={sending}>
                  {DAY_PART_LABELS[p]}
                </button>
              ))}
            </div>
          </fieldset>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Уточнение по времени</span>
            <input className={profileStyles.input} value={note} maxLength={NOTE_MAX} placeholder="Например: по будням после 19:00" onChange={(e) => setNote(e.target.value)} disabled={sending} />
          </label>

          <label className={profileStyles.field}>
            <span className={profileStyles.label}>Что ещё нам стоит знать</span>
            <textarea className={profileStyles.textarea} rows={3} value={comment} maxLength={COMMENT_MAX} placeholder="Опыт, травмы, пожелания к тренеру" onChange={(e) => setComment(e.target.value)} disabled={sending} />
            <span className={styles.counter}>
              {comment.length} / {COMMENT_MAX}
            </span>
          </label>

          {error && <p className={profileStyles.error}>{error}</p>}
          <button type="submit" className={profileStyles.buttonPrimary} disabled={!valid || sending}>
            {sending ? "Отправляем…" : "Отправить заявку"}
          </button>
        </form>
      )}

      {mineFailed && <p className={profileStyles.error}>Не удалось загрузить ваши заявки.</p>}
      {mine !== null && mine.length > 0 && (
        <div className={profileStyles.card}>
          <h2 className={styles.sectionTitle}>Ваши заявки</h2>
          <ul className={styles.list}>
            {mine.map((r) => (
              <RequestItem
                key={r.id}
                request={r}
                onWithdraw={() => void withdraw(r.id)}
                onAnswer={(offerId, accept) => void answer(offerId, accept)}
                onOpenCoach={onOpenCoach}
              />
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function RequestItem({
  request: r,
  onWithdraw,
  onAnswer,
  onOpenCoach,
}: {
  request: MatchRequest;
  onWithdraw: () => void;
  onAnswer: (offerId: string, accept: boolean) => void;
  onOpenCoach?: (coachUserId: string) => void;
}) {
  const open = r.status === "new" || r.status === "in_progress";
  const facts: [string, string | null][] = [
    ["Цель", r.goal],
    ["Уровень", r.level ? MATCH_LEVEL_LABELS[r.level] : null],
    ["Формат", r.format ? MATCH_FORMAT_LABELS[r.format] : null],
    ["Город", r.city],
    ["Бюджет", budgetText(r.budgetMin, r.budgetMax, r.currency)],
    ["Когда удобно", [whenText(r.weekdays, r.dayParts), r.scheduleNote].filter(Boolean).join(" · ") || null],
    ["Комментарий", r.comment],
  ];
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <div>
          <strong>{r.sport}</strong>
          <div className={styles.hint}>{formatWhen(r.createdAt)}</div>
        </div>
        <span className={styles.badge}>{MATCH_STATUS_LABELS[r.status]}</span>
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
      {r.offers.length > 0 && (
        <div className={styles.offers}>
          <strong>{r.status === "matched" ? "Ваш тренер" : "Тренеры, готовые с вами заниматься"}</strong>
          {r.status !== "matched" && (
            <p className={styles.hint}>Мы подобрали их из тренеров, участвующих в подборе. Выберите того, кто вам подходит.</p>
          )}
          {r.offers.map((offer) => (
            <OfferItem key={offer.id} offer={offer} matched={r.status === "matched"} onAnswer={onAnswer} onOpenCoach={onOpenCoach} />
          ))}
        </div>
      )}
      {open && (
        <button type="button" className={styles.link} onClick={onWithdraw}>
          Отозвать заявку
        </button>
      )}
    </li>
  );
}

function OfferItem({
  offer,
  matched,
  onAnswer,
  onOpenCoach,
}: {
  offer: MatchOffer;
  matched: boolean;
  onAnswer: (offerId: string, accept: boolean) => void;
  onOpenCoach?: (coachUserId: string) => void;
}) {
  const c = offer.coach;
  const details = [
    c.sport,
    c.specialization,
    c.experienceYears !== null ? `стаж ${c.experienceYears} лет` : null,
    c.averageRating !== null ? `★ ${c.averageRating.toFixed(1)} (${c.reviewCount})` : null,
  ].filter(Boolean);
  return (
    <div className={styles.offer}>
      <div>
        <strong>{c.fullName}</strong>
        {c.isPro && <span className={styles.pro}>Pro</span>}
        <div className={styles.hint}>{details.join(" · ")}</div>
        {offer.listings.length > 0 && (
          <div className={styles.hint}>
            {offer.listings.map((l) => (l.pricePerSession !== null ? `${l.title} — ${l.pricePerSession.toLocaleString("ru-RU")} ₽` : l.title)).join("; ")}
          </div>
        )}
        {!matched && offer.expiresAt && <div className={styles.hint}>Выберите до {formatWhen(offer.expiresAt)}</div>}
        {matched && (
          <div className={styles.hint}>
            Первую тренировку с этим тренером вы оплачиваете в приложении (цена не меняется): после оплаты откроется чат с тренером.
          </div>
        )}
      </div>
      <div className={styles.offerActions}>
        {onOpenCoach && (
          <button type="button" className={profileStyles.buttonSecondary} onClick={() => onOpenCoach(c.userId)}>
            {matched ? "Записаться на тренировку" : "Профиль тренера"}
          </button>
        )}
        {!matched && (
          <>
            <button type="button" className={profileStyles.buttonPrimary} onClick={() => onAnswer(offer.id, true)}>
              Выбрать этого тренера
            </button>
            <button type="button" className={styles.link} onClick={() => onAnswer(offer.id, false)}>
              Не подходит
            </button>
          </>
        )}
      </div>
    </div>
  );
}

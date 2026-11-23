import { apiRequest } from "./client";

export type MatchLevel = "beginner" | "amateur" | "advanced" | "pro";
export type MatchFormat = "online" | "offline" | "any";
export type DayPart = "morning" | "day" | "evening";
export type MatchStatus = "new" | "in_progress" | "matched" | "closed" | "canceled";
export type MatchOfferStatus =
  | "proposed"
  | "coach_declined"
  | "coach_accepted"
  | "athlete_declined"
  | "athlete_accepted"
  | "withdrawn"
  | "expired";

export const MATCH_LEVEL_LABELS: Record<MatchLevel, string> = { beginner: "Новичок", amateur: "Любитель", advanced: "Продвинутый", pro: "Профессионал" };
export const MATCH_FORMAT_LABELS: Record<MatchFormat, string> = { online: "Онлайн", offline: "Очно", any: "Не важно" };
export const DAY_PART_LABELS: Record<DayPart, string> = { morning: "Утро", day: "День", evening: "Вечер" };
/** 0 = Monday … 6 = Sunday, as in a trainer's availability windows. */
export const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;
/** What the author sees of the state of their request. */
export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  new: "Отправлена",
  in_progress: "Подбираем тренера",
  matched: "Тренер выбран",
  closed: "Обработана",
  canceled: "Отозвана",
};

export interface MatchRequestInput {
  sport: string;
  goal: string | null;
  level: MatchLevel | null;
  format: MatchFormat | null;
  city: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  weekdays: number[];
  dayParts: DayPart[];
  scheduleNote: string | null;
  comment: string | null;
}

/** The fields of a request, as the person (and the administrators) see them. */
export interface MatchRequestFields extends MatchRequestInput {
  currency: string;
}

/** A trainer who agreed to take the person; the person picks one (then books a session as usual) or declines. */
export interface MatchOfferCoach {
  userId: string;
  fullName: string;
  isPro: boolean;
  photoUrl: string | null;
  sport: string;
  specialization: string | null;
  experienceYears: number | null;
  averageRating: number | null;
  reviewCount: number;
}

export interface MatchOfferListing {
  id: string;
  title: string;
  pricePerSession: number | null;
  currency: string;
}

export interface MatchOffer {
  id: string;
  status: MatchOfferStatus;
  /** Until when the person can choose this trainer (null once chosen). */
  expiresAt: string | null;
  coach: MatchOfferCoach;
  listings: MatchOfferListing[];
}

export interface MatchRequest extends MatchRequestFields {
  id: string;
  status: MatchStatus;
  createdAt: string;
  offers: MatchOffer[];
}

export interface MatchOfferDto {
  id: string;
  status: MatchOfferStatus;
  expires_at: string | null;
  coach: {
    user_id: string;
    full_name: string;
    is_pro: boolean;
    photo_url: string | null;
    sport: string;
    specialization: string | null;
    experience_years: number | null;
    average_rating: number | null;
    review_count: number;
  };
  listings: { id: string; title: string; price_per_session: number | null; currency: string }[];
}

/** What both the person and the administrators get for a request (the offers differ: the person sees the trainers who agreed). */
export interface MatchRequestBaseDto {
  id: string;
  sport: string;
  goal: string | null;
  level: MatchLevel | null;
  format: MatchFormat | null;
  city: string | null;
  budget_min: string | number | null;
  budget_max: string | number | null;
  currency: string;
  weekdays: number[];
  day_parts: DayPart[];
  schedule_note: string | null;
  comment: string | null;
  status: MatchStatus;
  created_at: string;
}

export interface MatchRequestDto extends MatchRequestBaseDto {
  offers?: MatchOfferDto[];
}

const money = (value: string | number | null): number | null => (value === null ? null : Number(value));

export function mapMatchRequestBase(d: MatchRequestBaseDto): Omit<MatchRequest, "offers"> {
  return {
    id: d.id,
    sport: d.sport,
    goal: d.goal,
    level: d.level,
    format: d.format,
    city: d.city,
    budgetMin: money(d.budget_min),
    budgetMax: money(d.budget_max),
    currency: d.currency,
    weekdays: d.weekdays,
    dayParts: d.day_parts,
    scheduleNote: d.schedule_note,
    comment: d.comment,
    status: d.status,
    createdAt: d.created_at,
  };
}

export function mapMatchRequest(d: MatchRequestDto): MatchRequest {
  return { ...mapMatchRequestBase(d), offers: (d.offers ?? []).map(mapMatchOffer) };
}

function mapMatchOffer(d: MatchOfferDto): MatchOffer {
  return {
    id: d.id,
    status: d.status,
    expiresAt: d.expires_at,
    coach: {
      userId: d.coach.user_id,
      fullName: d.coach.full_name,
      isPro: d.coach.is_pro,
      photoUrl: d.coach.photo_url,
      sport: d.coach.sport,
      specialization: d.coach.specialization,
      experienceYears: d.coach.experience_years,
      averageRating: d.coach.average_rating,
      reviewCount: d.coach.review_count,
    },
    listings: d.listings.map((l) => ({ id: l.id, title: l.title, pricePerSession: l.price_per_session, currency: l.currency })),
  };
}

/** The form shows its own «спасибо» and its own error, so the generic toasts are off. */
export async function createMatchRequest(input: MatchRequestInput): Promise<MatchRequest> {
  const dto = await apiRequest<MatchRequestDto>("/api/match-requests", {
    method: "POST",
    silent: true,
    body: {
      sport: input.sport,
      goal: input.goal,
      level: input.level,
      format: input.format,
      city: input.city,
      budget_min: input.budgetMin,
      budget_max: input.budgetMax,
      weekdays: input.weekdays,
      day_parts: input.dayParts,
      schedule_note: input.scheduleNote,
      comment: input.comment,
    },
  });
  return mapMatchRequest(dto);
}

export async function listMyMatchRequests(): Promise<MatchRequest[]> {
  const dtos = await apiRequest<MatchRequestDto[]>("/api/match-requests/mine", { silent: true });
  return dtos.map(mapMatchRequest);
}

export async function cancelMatchRequest(id: string): Promise<MatchRequest> {
  return mapMatchRequest(await apiRequest<MatchRequestDto>(`/api/match-requests/${id}/cancel`, { method: "POST", silent: true }));
}

/** The person chooses this trainer: the request becomes «Тренер выбран». */
export async function acceptMatchOffer(offerId: string): Promise<MatchRequest> {
  return mapMatchRequest(await apiRequest<MatchRequestDto>(`/api/match-requests/offers/${offerId}/accept`, { method: "POST", silent: true }));
}

/** The person does not want this trainer; the request stays with the administrators. */
export async function declineMatchOffer(offerId: string): Promise<MatchRequest> {
  return mapMatchRequest(await apiRequest<MatchRequestDto>(`/api/match-requests/offers/${offerId}/decline`, { method: "POST", silent: true }));
}

/** «от 1 500 до 3 000 ₽», «до 3 000 ₽», «от 1 500 ₽»; null when no budget was given. */
export function budgetText(min: number | null, max: number | null, currency = "RUB"): string | null {
  const sign = currency === "RUB" ? "₽" : currency;
  const fmt = (n: number) => n.toLocaleString("ru-RU");
  if (min !== null && max !== null) return min === max ? `${fmt(min)} ${sign}` : `от ${fmt(min)} до ${fmt(max)} ${sign}`;
  if (max !== null) return `до ${fmt(max)} ${sign}`;
  if (min !== null) return `от ${fmt(min)} ${sign}`;
  return null;
}

/** «Пн, Ср · утро, вечер» for the days and the parts of the day the person named. */
export function whenText(weekdays: number[], dayParts: DayPart[]): string | null {
  const days = weekdays.map((d) => WEEKDAY_LABELS[d]).filter(Boolean).join(", ");
  const parts = dayParts.map((p) => DAY_PART_LABELS[p].toLowerCase()).join(", ");
  const text = [days, parts].filter(Boolean).join(" · ");
  return text || null;
}

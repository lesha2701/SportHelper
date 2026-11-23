import { apiRequest } from "./client";
import type { DayPart, MatchFormat, MatchLevel } from "./matchRequests";

/** The trainer's side of «Подобрать тренера»: consent to be recommended and answers to the offers of the administrators. */
export interface MatchOfferSettings {
  enabled: boolean;
  acceptedVersion: string | null;
  currentVersion: string;
  /** False when the current terms have to be accepted (again) before the matching can be switched on. */
  termsAccepted: boolean;
  firstSessionPercent: number;
  termsTitle: string;
  terms: string[];
}

interface MatchOfferSettingsDto {
  enabled: boolean;
  accepted_version: string | null;
  current_version: string;
  terms_accepted: boolean;
  first_session_percent: number;
  terms_title: string;
  terms: string[];
}

export type CoachOfferStatus = "proposed" | "coach_declined" | "coach_accepted" | "athlete_declined" | "athlete_accepted" | "withdrawn" | "expired";

/** The request as a trainer sees it: no name, no contacts (contacts in free text are already hidden by the server). */
export interface CoachOfferRequest {
  sport: string;
  goal: string | null;
  level: MatchLevel | null;
  format: MatchFormat | null;
  city: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  currency: string;
  weekdays: number[];
  dayParts: DayPart[];
  scheduleNote: string | null;
  comment: string | null;
}

export interface CoachOffer {
  id: string;
  status: CoachOfferStatus;
  createdAt: string;
  expiresAt: string;
  firstSessionPercent: number;
  adminMessage: string | null;
  request: CoachOfferRequest;
}

interface CoachOfferDto {
  id: string;
  status: CoachOfferStatus;
  created_at: string;
  expires_at: string;
  first_session_percent: number;
  admin_message: string | null;
  request: {
    sport: string;
    goal: string | null;
    level: MatchLevel | null;
    format: MatchFormat | null;
    city: string | null;
    budget_min: number | null;
    budget_max: number | null;
    currency: string;
    weekdays: number[];
    day_parts: DayPart[];
    schedule_note: string | null;
    comment: string | null;
  };
}

function mapSettings(d: MatchOfferSettingsDto): MatchOfferSettings {
  return {
    enabled: d.enabled,
    acceptedVersion: d.accepted_version,
    currentVersion: d.current_version,
    termsAccepted: d.terms_accepted,
    firstSessionPercent: d.first_session_percent,
    termsTitle: d.terms_title,
    terms: d.terms,
  };
}

function mapOffer(d: CoachOfferDto): CoachOffer {
  const r = d.request;
  return {
    id: d.id,
    status: d.status,
    createdAt: d.created_at,
    expiresAt: d.expires_at,
    firstSessionPercent: d.first_session_percent,
    adminMessage: d.admin_message,
    request: {
      sport: r.sport,
      goal: r.goal,
      level: r.level,
      format: r.format,
      city: r.city,
      budgetMin: r.budget_min,
      budgetMax: r.budget_max,
      currency: r.currency,
      weekdays: r.weekdays,
      dayParts: r.day_parts,
      scheduleNote: r.schedule_note,
      comment: r.comment,
    },
  };
}

export async function getMatchOfferSettings(): Promise<MatchOfferSettings> {
  return mapSettings(await apiRequest<MatchOfferSettingsDto>("/api/match-offers/settings", { silent: true }));
}

/** Switching on sends the version of the terms the trainer has read. */
export async function saveMatchOfferSettings(enabled: boolean, acceptTermsVersion: string | null): Promise<MatchOfferSettings> {
  return mapSettings(
    await apiRequest<MatchOfferSettingsDto>("/api/match-offers/settings", {
      method: "PUT",
      silent: true,
      body: { enabled, accept_terms_version: acceptTermsVersion },
    }),
  );
}

export async function listCoachOffers(): Promise<CoachOffer[]> {
  return (await apiRequest<CoachOfferDto[]>("/api/match-offers/incoming", { silent: true })).map(mapOffer);
}

export async function acceptCoachOffer(id: string): Promise<CoachOffer> {
  return mapOffer(await apiRequest<CoachOfferDto>(`/api/match-offers/${id}/accept`, { method: "POST", silent: true }));
}

export async function declineCoachOffer(id: string, reason: string | null): Promise<CoachOffer> {
  return mapOffer(await apiRequest<CoachOfferDto>(`/api/match-offers/${id}/decline`, { method: "POST", silent: true, body: { reason } }));
}

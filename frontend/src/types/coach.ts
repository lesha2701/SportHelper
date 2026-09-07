// frontend/src/types/coach.ts

export interface CoachMarketplaceSettingsDto {
  user_id: string;
  is_listed: boolean;
  price_per_session: number | null;
  currency: string;
  offers_online: boolean;
  offers_offline: boolean;
  location: string | null;
  session_duration_minutes: number | null;
}

export interface CoachMarketplaceSettings {
  userId: string;
  isListed: boolean;
  pricePerSession: number | null;
  currency: string;
  offersOnline: boolean;
  offersOffline: boolean;
  location: string | null;
  sessionDurationMinutes: number | null;
}

export function mapCoachMarketplaceSettingsDto(dto: CoachMarketplaceSettingsDto): CoachMarketplaceSettings {
  return {
    userId: dto.user_id,
    isListed: dto.is_listed,
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    offersOnline: dto.offers_online,
    offersOffline: dto.offers_offline,
    location: dto.location,
    sessionDurationMinutes: dto.session_duration_minutes,
  };
}

export interface CoachMarketplaceSettingsInput {
  is_listed: boolean;
  price_per_session: number | null;
  currency: string;
  offers_online: boolean;
  offers_offline: boolean;
  location: string | null;
  session_duration_minutes: number | null;
}

export interface AvailabilityWindowDto {
  id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface AvailabilityWindow {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export function mapAvailabilityWindowDto(dto: AvailabilityWindowDto): AvailabilityWindow {
  return { id: dto.id, weekday: dto.weekday, startTime: dto.start_time, endTime: dto.end_time };
}

export interface AvailabilityWindowInput {
  weekday: number;
  start_time: string;
  end_time: string;
}

export interface CoachCardDto {
  user_id: string;
  full_name: string;
  photo_url: string | null;
  sport: string;
  specialization: string | null;
  description: string | null;
  experience_years: number | null;
  average_rating: number | null;
  review_count: number;
  price_per_session: number | null;
  currency: string;
  location: string | null;
  offers_online: boolean;
  offers_offline: boolean;
  next_available_slot: string | null;
}

export interface CoachCard {
  userId: string;
  fullName: string;
  photoUrl: string | null;
  sport: string;
  specialization: string | null;
  description: string | null;
  experienceYears: number | null;
  averageRating: number | null;
  reviewCount: number;
  pricePerSession: number | null;
  currency: string;
  location: string | null;
  offersOnline: boolean;
  offersOffline: boolean;
  nextAvailableSlot: string | null;
}

export function mapCoachCardDto(dto: CoachCardDto): CoachCard {
  return {
    userId: dto.user_id,
    fullName: dto.full_name,
    photoUrl: dto.photo_url,
    sport: dto.sport,
    specialization: dto.specialization,
    description: dto.description,
    experienceYears: dto.experience_years,
    averageRating: dto.average_rating,
    reviewCount: dto.review_count,
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    location: dto.location,
    offersOnline: dto.offers_online,
    offersOffline: dto.offers_offline,
    nextAvailableSlot: dto.next_available_slot,
  };
}

export interface CoachReviewDto {
  id: string;
  athlete_first_name: string;
  rating: number;
  text: string | null;
  created_at: string;
}

export interface CoachReview {
  id: string;
  athleteFirstName: string;
  rating: number;
  text: string | null;
  createdAt: string;
}

function mapCoachReviewDto(dto: CoachReviewDto): CoachReview {
  return { id: dto.id, athleteFirstName: dto.athlete_first_name, rating: dto.rating, text: dto.text, createdAt: dto.created_at };
}

export interface CoachPublicProfileDto extends CoachCardDto {
  session_duration_minutes: number | null;
  availability: AvailabilityWindowDto[];
  recent_reviews: CoachReviewDto[];
}

export interface CoachPublicProfile extends CoachCard {
  sessionDurationMinutes: number | null;
  availability: AvailabilityWindow[];
  recentReviews: CoachReview[];
}

export function mapCoachPublicProfileDto(dto: CoachPublicProfileDto): CoachPublicProfile {
  return {
    ...mapCoachCardDto(dto),
    sessionDurationMinutes: dto.session_duration_minutes,
    availability: dto.availability.map(mapAvailabilityWindowDto),
    recentReviews: dto.recent_reviews.map(mapCoachReviewDto),
  };
}

export interface OpenSlotDto {
  starts_at: string;
  duration_minutes: number;
}

export interface OpenSlot {
  startsAt: string;
  durationMinutes: number;
}

export function mapOpenSlotDto(dto: OpenSlotDto): OpenSlot {
  return { startsAt: dto.starts_at, durationMinutes: dto.duration_minutes };
}

export interface CoachListFilters {
  sport?: string;
  location?: string;
  max_price?: number;
  min_rating?: number;
  format?: "online" | "offline";
  min_experience_years?: number;
}

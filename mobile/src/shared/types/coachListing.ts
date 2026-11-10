// frontend/src/types/coachListing.ts

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

export interface CoachListingDto {
  id: string;
  coach_user_id: string;
  title: string;
  description: string | null;
  is_listed: boolean;
  price_per_session: number | null;
  currency: string;
  offers_online: boolean;
  offers_offline: boolean;
  location: string | null;
  session_duration_minutes: number | null;
  photo_file_id: string | null;
  video_file_id: string | null;
}

export interface CoachListing {
  id: string;
  coachUserId: string;
  title: string;
  description: string | null;
  isListed: boolean;
  pricePerSession: number | null;
  currency: string;
  offersOnline: boolean;
  offersOffline: boolean;
  location: string | null;
  sessionDurationMinutes: number | null;
  photoFileId: string | null;
  videoFileId: string | null;
}

export function mapCoachListingDto(dto: CoachListingDto): CoachListing {
  return {
    id: dto.id,
    coachUserId: dto.coach_user_id,
    title: dto.title,
    description: dto.description,
    isListed: dto.is_listed,
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    offersOnline: dto.offers_online,
    offersOffline: dto.offers_offline,
    location: dto.location,
    sessionDurationMinutes: dto.session_duration_minutes,
    photoFileId: dto.photo_file_id,
    videoFileId: dto.video_file_id,
  };
}

export interface CoachListingInput {
  title: string;
  description: string | null;
  is_listed: boolean;
  price_per_session: number | null;
  currency: string;
  offers_online: boolean;
  offers_offline: boolean;
  location: string | null;
  session_duration_minutes: number | null;
}

export interface CoachListingCardDto {
  id: string;
  title: string;
  description: string | null;
  coach_user_id: string;
  coach_full_name: string;
  coach_photo_url: string | null;
  sport: string;
  specialization: string | null;
  experience_years: number | null;
  average_rating: number | null;
  review_count: number;
  price_per_session: number | null;
  currency: string;
  location: string | null;
  offers_online: boolean;
  offers_offline: boolean;
  photo_file_id: string | null;
  next_available_slot: string | null;
}

export interface CoachListingCard {
  id: string;
  title: string;
  description: string | null;
  coachUserId: string;
  coachFullName: string;
  coachPhotoUrl: string | null;
  sport: string;
  specialization: string | null;
  experienceYears: number | null;
  averageRating: number | null;
  reviewCount: number;
  pricePerSession: number | null;
  currency: string;
  location: string | null;
  offersOnline: boolean;
  offersOffline: boolean;
  photoFileId: string | null;
  nextAvailableSlot: string | null;
}

export function mapCoachListingCardDto(dto: CoachListingCardDto): CoachListingCard {
  return {
    id: dto.id,
    title: dto.title,
    description: dto.description,
    coachUserId: dto.coach_user_id,
    coachFullName: dto.coach_full_name,
    coachPhotoUrl: dto.coach_photo_url,
    sport: dto.sport,
    specialization: dto.specialization,
    experienceYears: dto.experience_years,
    averageRating: dto.average_rating,
    reviewCount: dto.review_count,
    pricePerSession: dto.price_per_session,
    currency: dto.currency,
    location: dto.location,
    offersOnline: dto.offers_online,
    offersOffline: dto.offers_offline,
    photoFileId: dto.photo_file_id,
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

export function mapCoachReviewDto(dto: CoachReviewDto): CoachReview {
  return { id: dto.id, athleteFirstName: dto.athlete_first_name, rating: dto.rating, text: dto.text, createdAt: dto.created_at };
}

export interface CoachListingProfileDto extends CoachListingCardDto {
  coach_description: string | null;
  session_duration_minutes: number | null;
  video_file_id: string | null;
  availability: AvailabilityWindowDto[];
  recent_reviews: CoachReviewDto[];
}

export interface CoachListingProfile extends CoachListingCard {
  coachDescription: string | null;
  sessionDurationMinutes: number | null;
  videoFileId: string | null;
  availability: AvailabilityWindow[];
  recentReviews: CoachReview[];
}

export function mapCoachListingProfileDto(dto: CoachListingProfileDto): CoachListingProfile {
  return {
    ...mapCoachListingCardDto(dto),
    coachDescription: dto.coach_description,
    sessionDurationMinutes: dto.session_duration_minutes,
    videoFileId: dto.video_file_id,
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

export interface CoachListingFilters {
  sport?: string;
  location?: string;
  min_price?: number;
  max_price?: number;
  min_rating?: number;
  format?: "online" | "offline";
  min_experience_years?: number;
}

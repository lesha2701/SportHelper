// frontend/src/types/coach.ts

export interface CoachPublicProfileDto {
  user_id: string;
  full_name: string;
  sport: string;
  specialization: string | null;
  experience_years: number | null;
  description: string | null;
  avatar_file_id: string | null;
  photo_url: string | null;
  average_rating: number | null;
  review_count: number;
}

export interface CoachPublicProfile {
  userId: string;
  fullName: string;
  sport: string;
  specialization: string | null;
  experienceYears: number | null;
  description: string | null;
  avatarFileId: string | null;
  photoUrl: string | null;
  averageRating: number | null;
  reviewCount: number;
}

export function mapCoachPublicProfileDto(dto: CoachPublicProfileDto): CoachPublicProfile {
  return {
    userId: dto.user_id,
    fullName: dto.full_name,
    sport: dto.sport,
    specialization: dto.specialization,
    experienceYears: dto.experience_years,
    description: dto.description,
    avatarFileId: dto.avatar_file_id,
    photoUrl: dto.photo_url,
    averageRating: dto.average_rating,
    reviewCount: dto.review_count,
  };
}

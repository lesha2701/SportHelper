export type ProfileMediaType = "photo" | "video";

export interface ProfileMediaDto {
  id: string;
  user_id: string;
  file_id: string;
  media_type: ProfileMediaType;
  caption: string | null;
  sort_order: number;
  created_at: string;
}

export interface ProfileMedia {
  id: string;
  userId: string;
  fileId: string;
  mediaType: ProfileMediaType;
  caption: string | null;
  sortOrder: number;
  createdAt: string;
}

export function mapProfileMediaDto(dto: ProfileMediaDto): ProfileMedia {
  return {
    id: dto.id,
    userId: dto.user_id,
    fileId: dto.file_id,
    mediaType: dto.media_type,
    caption: dto.caption,
    sortOrder: dto.sort_order,
    createdAt: dto.created_at,
  };
}

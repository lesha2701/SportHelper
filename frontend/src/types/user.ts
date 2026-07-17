export interface User {
  id: string;
  telegramId: number;
  username: string | null;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
  languageCode: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

/** Shape returned by the backend (snake_case), before mapping to `User`. */
export interface UserDto {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
  language_code: string | null;
  created_at: string;
  last_login_at: string | null;
}

export function mapUserDto(dto: UserDto): User {
  return {
    id: dto.id,
    telegramId: dto.telegram_id,
    username: dto.username,
    firstName: dto.first_name,
    lastName: dto.last_name,
    photoUrl: dto.photo_url,
    languageCode: dto.language_code,
    createdAt: dto.created_at,
    lastLoginAt: dto.last_login_at,
  };
}

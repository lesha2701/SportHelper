import type { SkillLevel } from "./profile";

export type TeamRole = "head_coach" | "assistant_coach" | "captain" | "player";
export type TeamStatus = "active" | "without_coach";
export type InviteKind = "join" | "head_coach";
export type JoinRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

export const TEAM_ROLE_LABELS: Record<TeamRole, string> = {
  head_coach: "Основной тренер",
  assistant_coach: "Помощник тренера",
  captain: "Капитан",
  player: "Игрок",
};

export interface Team {
  id: string;
  name: string;
  description: string | null;
  sport: string;
  ageCategory: string | null;
  level: SkillLevel | null;
  status: TeamStatus;
  createdBy: string;
  logoFileId: string | null;
  myRole: TeamRole | null;
  membersCount: number;
}

export interface TeamMember {
  userId: string;
  telegramId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  role: TeamRole;
  position: string | null;
  joinedAt: string;
}

export interface Invite {
  id: string;
  teamId: string;
  token: string;
  kind: InviteKind;
  link: string;
  expiresAt: string;
  createdAt: string;
}

export interface JoinRequest {
  id: string;
  teamId: string;
  userId: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  status: JoinRequestStatus;
  createdAt: string;
}

export interface TeamDto {
  id: string;
  name: string;
  description: string | null;
  sport: string;
  age_category: string | null;
  level: SkillLevel | null;
  status: TeamStatus;
  created_by: string;
  logo_file_id: string | null;
  created_at: string;
  updated_at: string;
  my_role: TeamRole | null;
  members_count: number;
}

export interface TeamMemberDto {
  user_id: string;
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  role: TeamRole;
  position: string | null;
  joined_at: string;
}

export interface InviteDto {
  id: string;
  team_id: string;
  token: string;
  kind: InviteKind;
  link: string;
  expires_at: string;
  created_at: string;
}

export interface JoinRequestDto {
  id: string;
  team_id: string;
  user_id: string;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  status: JoinRequestStatus;
  created_at: string;
}

export function mapTeamDto(dto: TeamDto): Team {
  return {
    id: dto.id,
    name: dto.name,
    description: dto.description,
    sport: dto.sport,
    ageCategory: dto.age_category,
    level: dto.level,
    status: dto.status,
    createdBy: dto.created_by,
    logoFileId: dto.logo_file_id,
    myRole: dto.my_role,
    membersCount: dto.members_count,
  };
}

export function mapTeamMemberDto(dto: TeamMemberDto): TeamMember {
  return {
    userId: dto.user_id,
    telegramId: dto.telegram_id,
    firstName: dto.first_name,
    lastName: dto.last_name,
    username: dto.username,
    photoUrl: dto.photo_url,
    role: dto.role,
    position: dto.position,
    joinedAt: dto.joined_at,
  };
}

export function mapInviteDto(dto: InviteDto): Invite {
  return {
    id: dto.id,
    teamId: dto.team_id,
    token: dto.token,
    kind: dto.kind,
    link: dto.link,
    expiresAt: dto.expires_at,
    createdAt: dto.created_at,
  };
}

export function mapJoinRequestDto(dto: JoinRequestDto): JoinRequest {
  return {
    id: dto.id,
    teamId: dto.team_id,
    userId: dto.user_id,
    firstName: dto.first_name,
    lastName: dto.last_name,
    username: dto.username,
    photoUrl: dto.photo_url,
    status: dto.status,
    createdAt: dto.created_at,
  };
}

export interface TeamInput {
  name: string;
  description: string | null;
  sport: string;
  age_category: string | null;
  level: SkillLevel | null;
}

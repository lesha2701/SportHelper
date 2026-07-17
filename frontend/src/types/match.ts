export type MatchStatus = "scheduled" | "completed" | "cancelled";
export type MatchResult = "win" | "loss" | "draw";

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  scheduled: "Запланирован",
  completed: "Завершён",
  cancelled: "Отменён",
};

export const MATCH_RESULT_LABELS: Record<MatchResult, string> = {
  win: "Победа",
  loss: "Поражение",
  draw: "Ничья",
};

export interface RosterMember {
  id: string;
  matchId: string;
  userId: string;
  telegramId: number;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
}

export interface Match {
  id: string;
  teamId: string;
  createdBy: string;
  opponentName: string;
  matchDate: string;
  startTime: string;
  location: string | null;
  isHome: boolean;
  tournament: string | null;
  status: MatchStatus;
  ourScore: number | null;
  opponentScore: number | null;
  result: MatchResult | null;
  comment: string | null;
  roster: RosterMember[];
}

export interface MatchCreateInput {
  opponent_name: string;
  match_date: string;
  start_time: string;
  location: string | null;
  is_home: boolean;
  tournament: string | null;
}

export interface MatchUpdateInput extends MatchCreateInput {
  status: MatchStatus;
}

export interface MatchResultInput {
  our_score: number;
  opponent_score: number;
  comment: string | null;
}

export interface MatchRosterInput {
  user_ids: string[];
}

export interface RosterMemberDto {
  id: string;
  match_id: string;
  user_id: string;
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
}

export interface MatchDto {
  id: string;
  team_id: string;
  created_by: string;
  opponent_name: string;
  match_date: string;
  start_time: string;
  location: string | null;
  is_home: boolean;
  tournament: string | null;
  status: MatchStatus;
  our_score: number | null;
  opponent_score: number | null;
  result: MatchResult | null;
  comment: string | null;
  roster: RosterMemberDto[];
}

export function mapRosterMemberDto(dto: RosterMemberDto): RosterMember {
  return {
    id: dto.id,
    matchId: dto.match_id,
    userId: dto.user_id,
    telegramId: dto.telegram_id,
    firstName: dto.first_name,
    lastName: dto.last_name,
    photoUrl: dto.photo_url,
  };
}

export function mapMatchDto(dto: MatchDto): Match {
  return {
    id: dto.id,
    teamId: dto.team_id,
    createdBy: dto.created_by,
    opponentName: dto.opponent_name,
    matchDate: dto.match_date,
    startTime: dto.start_time,
    location: dto.location,
    isHome: dto.is_home,
    tournament: dto.tournament,
    status: dto.status,
    ourScore: dto.our_score,
    opponentScore: dto.opponent_score,
    result: dto.result,
    comment: dto.comment,
    roster: dto.roster.map(mapRosterMemberDto),
  };
}

import { mapMetricDto, mapPersonalRecordDto, type Metric, type MetricDto, type PersonalRecord, type PersonalRecordDto } from "./metric";

export interface PlayerActivity {
  userId: string;
  firstName: string;
  lastName: string | null;
  presentCount: number;
  absentCount: number;
  attendanceRate: number | null;
}

export interface TeamStats {
  membersCount: number;
  trainingsCompleted: number;
  trainingsUpcoming: number;
  independentTrainings: number;
  attendanceRate: number | null;
  tasksTotal: number;
  tasksCompleted: number;
  tasksOverdue: number;
  avgDifficulty: number | null;
  avgWellbeing: number | null;
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  matchesDrawn: number;
  lowActivityPlayers: PlayerActivity[];
  frequentAbsencePlayers: PlayerActivity[];
}

export interface CoachComment {
  context: string;
  comment: string;
  commentedAt: string | null;
}

export interface MatchHistoryEntry {
  id: string;
  opponentName: string;
  matchDate: string;
  ourScore: number | null;
  opponentScore: number | null;
  status: string;
  teamName: string | null;
}

export interface PlayerStats {
  trainingsAttended: number;
  trainingsTotal: number;
  attendanceRate: number | null;
  trainingMinutes: number;
  teamTrainingsCount: number;
  personalTrainingsCount: number;
  activityStreak: number;
  tasksTotal: number;
  tasksCompleted: number;
  tasksOverdue: number;
  matchesHistory: MatchHistoryEntry[];
  coachComments: CoachComment[];
  metrics: Metric[];
  personalRecords: PersonalRecord[];
}

interface PlayerActivityDto {
  user_id: string;
  first_name: string;
  last_name: string | null;
  present_count: number;
  absent_count: number;
  attendance_rate: number | null;
}

export interface TeamStatsDto {
  members_count: number;
  trainings_completed: number;
  trainings_upcoming: number;
  independent_trainings: number;
  attendance_rate: number | null;
  tasks_total: number;
  tasks_completed: number;
  tasks_overdue: number;
  avg_difficulty: number | null;
  avg_wellbeing: number | null;
  matches_played: number;
  matches_won: number;
  matches_lost: number;
  matches_drawn: number;
  low_activity_players: PlayerActivityDto[];
  frequent_absence_players: PlayerActivityDto[];
}

interface CoachCommentDto {
  context: string;
  comment: string;
  commented_at: string | null;
}

interface MatchHistoryEntryDto {
  id: string;
  opponent_name: string;
  match_date: string;
  our_score: number | null;
  opponent_score: number | null;
  status: string;
  team_name: string | null;
}

export interface PlayerStatsDto {
  trainings_attended: number;
  trainings_total: number;
  attendance_rate: number | null;
  training_minutes: number;
  team_trainings_count: number;
  personal_trainings_count: number;
  activity_streak: number;
  tasks_total: number;
  tasks_completed: number;
  tasks_overdue: number;
  matches_history: MatchHistoryEntryDto[];
  coach_comments: CoachCommentDto[];
  metrics: MetricDto[];
  personal_records: PersonalRecordDto[];
}

function mapPlayerActivityDto(dto: PlayerActivityDto): PlayerActivity {
  return {
    userId: dto.user_id,
    firstName: dto.first_name,
    lastName: dto.last_name,
    presentCount: dto.present_count,
    absentCount: dto.absent_count,
    attendanceRate: dto.attendance_rate,
  };
}

export function mapTeamStatsDto(dto: TeamStatsDto): TeamStats {
  return {
    membersCount: dto.members_count,
    trainingsCompleted: dto.trainings_completed,
    trainingsUpcoming: dto.trainings_upcoming,
    independentTrainings: dto.independent_trainings,
    attendanceRate: dto.attendance_rate,
    tasksTotal: dto.tasks_total,
    tasksCompleted: dto.tasks_completed,
    tasksOverdue: dto.tasks_overdue,
    avgDifficulty: dto.avg_difficulty,
    avgWellbeing: dto.avg_wellbeing,
    matchesPlayed: dto.matches_played,
    matchesWon: dto.matches_won,
    matchesLost: dto.matches_lost,
    matchesDrawn: dto.matches_drawn,
    lowActivityPlayers: dto.low_activity_players.map(mapPlayerActivityDto),
    frequentAbsencePlayers: dto.frequent_absence_players.map(mapPlayerActivityDto),
  };
}

export function mapPlayerStatsDto(dto: PlayerStatsDto): PlayerStats {
  return {
    trainingsAttended: dto.trainings_attended,
    trainingsTotal: dto.trainings_total,
    attendanceRate: dto.attendance_rate,
    trainingMinutes: dto.training_minutes,
    teamTrainingsCount: dto.team_trainings_count,
    personalTrainingsCount: dto.personal_trainings_count,
    activityStreak: dto.activity_streak,
    tasksTotal: dto.tasks_total,
    tasksCompleted: dto.tasks_completed,
    tasksOverdue: dto.tasks_overdue,
    matchesHistory: dto.matches_history.map((m) => ({
      id: m.id,
      opponentName: m.opponent_name,
      matchDate: m.match_date,
      ourScore: m.our_score,
      opponentScore: m.opponent_score,
      status: m.status,
      teamName: m.team_name,
    })),
    coachComments: dto.coach_comments.map((c) => ({ context: c.context, comment: c.comment, commentedAt: c.commented_at })),
    metrics: dto.metrics.map(mapMetricDto),
    personalRecords: dto.personal_records.map(mapPersonalRecordDto),
  };
}

export function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

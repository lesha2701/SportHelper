import type { IconName } from "../components/shared/Icon";

export type CalendarEventType = "training" | "match" | "task_deadline";

export const CALENDAR_EVENT_ICONS: Record<CalendarEventType, IconName> = {
  training: "dumbbell",
  match: "ball",
  task_deadline: "clipboard",
};

export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  date: string;
  time: string | null;
  title: string;
  teamId: string | null;
  teamName: string | null;
  status: string;
}

export interface CalendarEventDto {
  id: string;
  type: CalendarEventType;
  date: string;
  time: string | null;
  title: string;
  team_id: string | null;
  team_name: string | null;
  status: string;
}

export function mapCalendarEventDto(dto: CalendarEventDto): CalendarEvent {
  return {
    id: dto.id,
    type: dto.type,
    date: dto.date,
    time: dto.time,
    title: dto.title,
    teamId: dto.team_id,
    teamName: dto.team_name,
    status: dto.status,
  };
}

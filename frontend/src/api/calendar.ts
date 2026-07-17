import { apiRequest } from "./client";
import { mapCalendarEventDto, type CalendarEvent, type CalendarEventDto } from "../types/calendar";

export async function getCalendar(token: string, dateFrom: string, dateTo: string): Promise<CalendarEvent[]> {
  const dtos = await apiRequest<CalendarEventDto[]>(`/api/calendar?date_from=${dateFrom}&date_to=${dateTo}`, { token });
  return dtos.map(mapCalendarEventDto);
}

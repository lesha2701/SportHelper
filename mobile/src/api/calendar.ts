import { apiRequest } from "./client";
import { mapCalendarEventDto, type CalendarEvent, type CalendarEventDto } from "@/shared/types/calendar";

export async function getCalendar(dateFrom: string, dateTo: string): Promise<CalendarEvent[]> {
  const dtos = await apiRequest<CalendarEventDto[]>(`/api/calendar?date_from=${dateFrom}&date_to=${dateTo}`);
  return dtos.map(mapCalendarEventDto);
}

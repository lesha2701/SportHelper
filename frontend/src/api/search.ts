import { apiRequest } from "./client";

export type SearchResultType = "team" | "player" | "coach" | "exercise" | "training" | "match" | "task";

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  teamId: string | null;
  onDate: string | null;
}

interface SearchResultDto {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string | null;
  team_id: string | null;
  on_date: string | null;
}

export async function searchAll(token: string, query: string): Promise<SearchResult[]> {
  const dtos = await apiRequest<SearchResultDto[]>(`/api/search?q=${encodeURIComponent(query)}`, { token });
  return dtos.map((d) => ({
    type: d.type,
    id: d.id,
    title: d.title,
    subtitle: d.subtitle,
    teamId: d.team_id,
    onDate: d.on_date,
  }));
}

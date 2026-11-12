/** The server's limits for the tournaments of a team (backend/app/schemas/team.py). */
export const MAX_TOURNAMENTS = 20;
export const MAX_TOURNAMENT_NAME = 150;

/** One tournament per line: blank lines are dropped, names trimmed, repeats kept once. */
export function parseTournamentLines(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split("\n")) {
    const name = line.trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function joinTournamentLines(names: string[]): string {
  return names.join("\n");
}

/** The place a new match starts with: the team's home venue for a home game, nothing for an away one. */
export function matchPlaceFor(isHome: boolean, homeVenue: string | null): string {
  return isHome ? (homeVenue ?? "") : "";
}

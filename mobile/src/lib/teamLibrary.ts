export type LibraryKind = "exercises" | "plans";

/** «упражнения» / «планы»: what is meant, in the plural, as the screens name it. */
export function libraryNoun(kind: LibraryKind): string {
  return kind === "exercises" ? "упражнения" : "планы";
}

/** What the empty list of a team's materials says: the coach is told how to fill it, a player is told to wait. */
export function emptyLibraryText(kind: LibraryKind, staff: boolean): { title: string; hint: string } {
  const title = kind === "exercises" ? "Упражнений нет" : "Планов нет";
  const hint = staff
    ? `Откройте команде свои ${libraryNoun(kind)} кнопкой выше — игроки увидят их здесь.`
    : `Тренер ещё не открыл команде ни одного ${kind === "exercises" ? "упражнения" : "плана"}.`;
  return { title, hint };
}

/** Whether a person sees the owner's tools (edit, delete, open to teams) on an exercise or a plan: only its author. */
export function isLibraryOwner(userId: string | null | undefined, ownerId: string): boolean {
  return !!userId && userId === ownerId;
}

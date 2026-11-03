/** Russian number agreement: 1 год, 2 года, 5 лет; 11 лет, 21 год, 22 года. */
export function pluralize(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const last = abs % 10;
  const lastTwo = abs % 100;
  if (last === 1 && lastTwo !== 11) return one;
  if (last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14)) return few;
  return many;
}

/** "3 года", "1 отзыв", "12 отзывов". */
export function count(n: number, one: string, few: string, many: string): string {
  return `${n} ${pluralize(n, one, few, many)}`;
}

/** Years of age or of experience; `tail` is what follows ("опыта" in "5 лет опыта"). */
export function years(n: number): string {
  return count(n, "год", "года", "лет");
}

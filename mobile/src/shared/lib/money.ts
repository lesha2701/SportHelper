/** Money on the screen. The server sends integer kopecks and everything stays integer until the last moment. */

const RUB = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatKopecks(kopecks: number): string {
  return RUB.format(kopecks / 100);
}

/** "1 500", "1500,5", "1500.50" -> kopecks, exactly (no floating point). null when it is not a valid amount with at most 2 decimals. */
export function parseRubles(text: string): number | null {
  const cleaned = text.replace(/[\s ]/g, "").replace(",", ".");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const kopecks = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return kopecks > 0 ? kopecks : null;
}

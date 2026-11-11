/** "YYYY-MM-DD" of the device's own calendar day. Not `toISOString().slice(0, 10)`: that is the UTC day, which in Moscow
 * is still yesterday between 00:00 and 03:00 (REF-19). Session dates are calendar days of the platform (Moscow), and
 * the people using it are there, so the device's day is the one to compare them with. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

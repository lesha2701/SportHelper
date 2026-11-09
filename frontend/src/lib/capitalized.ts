/** The explanation under a heading begins with a capital, however it was written. */
export function capitalized(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

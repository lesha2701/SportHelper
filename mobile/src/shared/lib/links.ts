/** The one-time token from what a person pasted: the whole link from the email, or just the token. */
export function extractToken(input: string): string {
  const text = input.trim();
  const match = /[?&]token=([^&#\s]+)/.exec(text);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
  return text;
}

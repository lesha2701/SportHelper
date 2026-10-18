/** The visitor's cookie choice, kept in this browser only (it is asked before there is an account to attach it to).
 * "necessary": only what the site needs to work. "all": also analytics cookies. The site has no analytics yet, so for now
 * the choice is just remembered; anything added later must check `analyticsAllowed()` first. */
export type CookieChoice = "all" | "necessary";

const KEY = "sag_cookie_choice";

export function readCookieChoice(): CookieChoice | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { choice?: unknown };
    return parsed.choice === "all" || parsed.choice === "necessary" ? parsed.choice : null;
  } catch {
    return null;
  }
}

export function saveCookieChoice(choice: CookieChoice): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ choice, at: new Date().toISOString() }));
  } catch {
    // Storage can be blocked; the banner then simply asks again next time.
  }
}

export function analyticsAllowed(): boolean {
  return readCookieChoice() === "all";
}

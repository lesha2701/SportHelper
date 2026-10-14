import { useEffect, useState } from "react";

/** A deliberately tiny History-API router: the site only has a handful of
 * public/auth pages (the signed-in app keeps its own state-driven navigation),
 * so a dependency would be overkill. */

const NAVIGATE_EVENT = "sag:navigate";

export interface Location {
  path: string;
  search: string;
}

function readLocation(): Location {
  return { path: window.location.pathname.replace(/\/+$/, "") || "/", search: window.location.search };
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  const target = new URL(to, window.location.origin);
  if (target.origin !== window.location.origin) {
    window.location.assign(to); // never "navigate" cross-origin through history
    return;
  }
  const url = target.pathname + target.search + target.hash;
  if (options.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
  if (!target.hash) window.scrollTo?.(0, 0);
}

export function useLocation(): Location {
  const [location, setLocation] = useState<Location>(readLocation);
  useEffect(() => {
    const update = () => setLocation(readLocation());
    window.addEventListener("popstate", update);
    window.addEventListener(NAVIGATE_EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(NAVIGATE_EVENT, update);
    };
  }, []);
  return location;
}

/** Accepts only a same-site path ("/something?x=1"), so a crafted
 * `?next=https://evil.example` can never turn the login page into an open redirect. */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  for (let i = 0; i < raw.length; i++) {
    if (raw.charCodeAt(i) < 0x20) return null; // control characters (incl. CR/LF) have no place in a path
  }
  return raw;
}

export function loginUrl(next?: string | null): string {
  const safe = safeNext(next ?? null);
  return safe && safe !== "/" ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

export function registerUrl(next?: string | null): string {
  const safe = safeNext(next ?? null);
  return safe && safe !== "/" ? `/register?next=${encodeURIComponent(safe)}` : "/register";
}

export function currentPathWithSearch(): string {
  return window.location.pathname + window.location.search;
}

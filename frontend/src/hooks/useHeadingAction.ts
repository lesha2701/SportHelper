import { createContext, useContext, useEffect, useRef } from "react";

/** A page's main action can live in the page heading (outside the screen) on desktop. Each press there raises `request`; the screen
 * runs `action` when it goes up while the screen is open. The value the screen mounted with was already handled, so coming back to
 * a tab does not repeat an old press. */
export function useHeadingAction(request: number | undefined, action: () => void): void {
  const seen = useRef(request ?? 0);
  const latest = useRef(action);
  useEffect(() => {
    latest.current = action;
  });
  useEffect(() => {
    if (request === undefined || request === seen.current) return;
    seen.current = request;
    latest.current();
  }, [request]);
}

/** Lets a screen tell the page heading whether its main button still fits: «Создать команду» makes no sense above a team's own page. */
export const HeadingActionVisibility = createContext<(visible: boolean) => void>(() => {});

/** Call with `false` while the screen shows something other than its list (a form, a detail page); the button comes back on leaving. */
export function useHeadingActionVisible(visible: boolean): void {
  const setVisible = useContext(HeadingActionVisibility);
  useEffect(() => {
    setVisible(visible);
    return () => setVisible(true);
  }, [visible, setVisible]);
}

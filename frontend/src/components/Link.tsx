import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate } from "../router";

/** A real <a href> (so it can be opened in a new tab, copied, and read by
 * assistive tech) that navigates without a page reload on a plain click. */
export function Link({ to, onClick, ...rest }: { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a {...rest} href={to} onClick={handleClick} />;
}

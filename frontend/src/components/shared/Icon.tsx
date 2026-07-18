import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "trophy"
  | "book"
  | "calendar"
  | "user"
  | "users"
  | "dumbbell"
  | "ball"
  | "clipboard"
  | "alert-triangle"
  | "inbox"
  | "lock"
  | "sparkles"
  | "check"
  | "check-circle"
  | "edit"
  | "plus"
  | "chevron-right"
  | "chevron-left"
  | "x"
  | "trash"
  | "search"
  | "bell"
  | "settings"
  | "sun"
  | "moon"
  | "grip"
  | "clock"
  | "award"
  | "image"
  | "video"
  | "filter"
  | "map-pin"
  | "flag";

const PATHS: Record<IconName, ReactElement> = {
  trophy: (
    <>
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4a2 2 0 0 0 0 4h1.5M17 5h3a2 2 0 0 1 0 4h-1.5" />
      <path d="M9.5 15.5 9 20H8m6.5-4.5.5 4.5h1" />
      <path d="M8 20h8" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v17H7.5A2.5 2.5 0 0 0 5 21.5Z" />
      <path d="M5 4.5v15A2.5 2.5 0 0 0 7.5 22H19" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20.5c1.4-3.7 4.2-5.5 7.5-5.5s6.1 1.8 7.5 5.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c1.1-3.2 3.3-4.8 6-4.8s4.9 1.6 6 4.8" />
      <path d="M15.5 5a3 3 0 0 1 0 5.8M18.5 20c-.6-2-1.7-3.4-3.2-4.2" />
    </>
  ),
  dumbbell: (
    <>
      <path d="M4 9v6M2.5 10.5v3M20 9v6M21.5 10.5v3" />
      <path d="M7 8v8M17 8v8" />
      <path d="M7 12h10" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 6.2 15.8 9l-1.4 4.4h-4.8L8.2 9zM12 6.2V3.5M8.4 13.4l-3.6 2.4M15.6 13.4l3.6 2.4M9.2 20.4 10.4 13.4M14.8 20.4 13.6 13.4" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="17" rx="2.2" />
      <rect x="8.5" y="2.5" width="7" height="3.6" rx="1.3" />
      <path d="M8.5 11h7M8.5 14.7h7M8.5 18.4h4.2" />
    </>
  ),
  "alert-triangle": (
    <>
      <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
      <path d="M12 9.5v4.2" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  inbox: (
    <>
      <path d="M3.5 12h5l1.5 3h4l1.5-3h5" />
      <path d="M5.2 5h13.6L21 12v6a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 18v-6l2.2-7Z" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
      <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
      <path d="M12 14.3v3" />
    </>
  ),
  sparkles: (
    <>
      <path d="M11 3.5 12.4 8l4.5 1.4-4.5 1.4L11 15.3 9.6 10.8 5.1 9.4l4.5-1.4Z" />
      <path d="M18 15l.8 2.4L21 18l-2.2.7-.8 2.4-.8-2.4L15 18l2.2-.6Z" />
    </>
  ),
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8 12.3l2.6 2.6L16.3 9" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4.2L18.8 9.4a2.4 2.4 0 0 0-3.4-3.4L5 16.6V20Z" />
      <path d="M13.5 7.5l3 3" />
    </>
  ),
  plus: <path d="M12 4.5v15M4.5 12h15" />,
  "chevron-right": <path d="M9 5.5 16 12l-7 6.5" />,
  "chevron-left": <path d="M15 5.5 8 12l7 6.5" />,
  x: <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" />,
  trash: (
    <>
      <path d="M5 7.5h14M9.5 7.5V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2v2.3" />
      <path d="M7 7.5 7.8 19a1.6 1.6 0 0 0 1.6 1.5h5.2a1.6 1.6 0 0 0 1.6-1.5l.8-11.5" />
      <path d="M10.3 11v6M13.7 11v6" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="M20 20l-4.8-4.8" />
    </>
  ),
  bell: (
    <>
      <path d="M6 10.5a6 6 0 0 1 12 0c0 4 1.4 5.6 1.9 6.2H4.1c.5-.6 1.9-2.2 1.9-6.2Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.6V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.6 1H20a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.3" />
      <path d="M12 2.5v2.3M12 19.2v2.3M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.3M19.2 12h2.3M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" />
    </>
  ),
  moon: <path d="M20 13.8A8.5 8.5 0 1 1 10.2 4a6.8 6.8 0 0 0 9.8 9.8Z" />,
  grip: (
    <>
      <circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="8.5" r="5" />
      <path d="M9 12.8 7.5 20l4.5-2.4 4.5 2.4-1.5-7.2" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M5 18l5-5.5 3 3 2.5-3L20.5 17" />
    </>
  ),
  video: (
    <>
      <rect x="3.5" y="6" width="12" height="12" rx="2" />
      <path d="M15.5 10.2 20.5 7v10l-5-3.2Z" />
    </>
  ),
  filter: <path d="M4 5h16l-6 7.5v5.5l-4 2v-7.5Z" />,
  "map-pin": (
    <>
      <path d="M12 21.5s7-6.4 7-12A7 7 0 0 0 5 9.5c0 5.6 7 12 7 12Z" />
      <circle cx="12" cy="9.3" r="2.4" />
    </>
  ),
  flag: (
    <>
      <path d="M5.5 21V4M5.5 4h11l-2.6 3.6L16.5 11h-11" />
    </>
  ),
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, strokeWidth = 1.8, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

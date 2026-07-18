import type { SVGProps } from "react";

// Larger companions to the Icon set, used only on StateScreen (empty/error/
// forbidden). Same visual language as Icon.tsx — currentColor stroke,
// rounded caps, no fill except small accent dots — so they read as part of
// the same system rather than imported clip art.

function Base(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={96}
      height={96}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  );
}

export function EmptyIllustration() {
  return (
    <Base>
      <rect x="7" y="16" width="26" height="20" rx="3" opacity={0.45} />
      <rect x="15" y="9" width="26" height="20" rx="3" strokeDasharray="3 3.2" />
      <path d="M28 14v10M23 19h10" />
    </Base>
  );
}

export function ErrorIllustration() {
  return (
    <Base>
      <rect x="11" y="8" width="26" height="32" rx="4" />
      <path d="M18 8l6 11-7 4 13 17" />
      <circle cx="34" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function ForbiddenIllustration() {
  return (
    <Base>
      <circle cx="24" cy="24" r="17" strokeDasharray="2.5 4" opacity={0.5} />
      <rect x="15" y="22" width="18" height="14" rx="3" />
      <path d="M19 22v-5a5 5 0 0 1 10 0v5" />
      <path d="M24 27v3" />
    </Base>
  );
}

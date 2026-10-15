import logoUrl from "../../assets/logo-256.webp";

/** The SportArena Global emblem. Decorative by default (the brand name is always
 * written next to it); pass `label` where it stands alone. */
export function BrandLogo({ className, label }: { className?: string; label?: string }) {
  return (
    <img
      src={logoUrl}
      className={className}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      width={256}
      height={256}
      draggable={false}
    />
  );
}

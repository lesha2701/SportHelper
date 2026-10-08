import { useEffect, useState } from "react";

const PHONE_QUERY = "(max-width: 640px)";

/** True on a phone-sized viewport. Reactive to resizes/rotation. */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches);

  useEffect(() => {
    const mql = window.matchMedia(PHONE_QUERY);
    const onChange = () => setIsPhone(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isPhone;
}

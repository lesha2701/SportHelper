import { useCallback, useEffect, useRef, useState } from "react";

/** Counts down from `seconds` after `start()`; paces "send again" buttons. */
export function useCooldown(seconds: number): { remaining: number; start: () => void } {
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    setRemaining(seconds);
    timer.current = setInterval(() => {
      setRemaining((value) => {
        if (value <= 1) {
          stop();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  }, [seconds, stop]);

  useEffect(() => stop, [stop]);
  return { remaining, start };
}

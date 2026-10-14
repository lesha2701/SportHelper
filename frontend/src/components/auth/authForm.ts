import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../api/client";

export interface FormError {
  message: string;
  field: string | null;
  code: string | null;
  retryAfter: number | null;
}

export function toFormError(error: unknown): FormError {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return {
        message: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.",
        field: null,
        code: error.code,
        retryAfter: null,
      };
    }
    if (error.code === "rate_limited" || error.code === "account_locked") {
      const wait = error.retryAfter ? ` Повторить можно через ${formatWait(error.retryAfter)}.` : "";
      return { message: `${error.message}${wait}`, field: null, code: error.code, retryAfter: error.retryAfter };
    }
    return { message: error.message, field: error.field, code: error.code, retryAfter: error.retryAfter };
  }
  return { message: "Что-то пошло не так. Попробуйте ещё раз.", field: null, code: null, retryAfter: null };
}

export function formatWait(seconds: number): string {
  if (seconds < 90) return `${seconds} сек.`;
  return `${Math.ceil(seconds / 60)} мин.`;
}

/** Counts down from `seconds` after `start()`; used to pace "send again" buttons. */
export function useCooldown(seconds: number): { remaining: number; start: () => void } {
  const [remaining, setRemaining] = useState(0);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  }, []);

  const start = useCallback(() => {
    stop();
    setRemaining(seconds);
    timer.current = window.setInterval(() => {
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

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A quick shape check so obvious typos are caught before a round trip; the
 * server's validation is the real one. */
export function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

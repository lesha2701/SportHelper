import { ApiError } from "@/api/client";

export interface FormError {
  message: string;
  field: string | null;
  code: string | null;
}

function formatWait(seconds: number): string {
  return seconds < 90 ? `${seconds} сек` : `${Math.ceil(seconds / 60)} мин`;
}

/** An error as a form shows it: network failures and rate limits get a plain-language message. */
export function toFormError(error: unknown): FormError {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return { message: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.", field: null, code: error.code };
    }
    if (error.code === "rate_limited" || error.code === "account_locked") {
      const wait = error.retryAfter ? ` Повторить можно через ${formatWait(error.retryAfter)}.` : "";
      return { message: `${error.message}${wait}`, field: null, code: error.code };
    }
    return { message: error.message, field: error.field, code: error.code };
  }
  return { message: "Что-то пошло не так. Попробуйте ещё раз.", field: null, code: null };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

export const PASSWORD_MIN_LENGTH = 12;

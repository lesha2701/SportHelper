import { describe, expect, it } from "@jest/globals";
import { ApiError } from "@/api/client";
import { looksLikeEmail, toFormError } from "./formError";

describe("toFormError", () => {
  it("explains a network failure in plain words", () => {
    const failure = toFormError(new ApiError(0, "network_error", "x"));
    expect(failure.message).toContain("Нет связи");
  });

  it("adds the wait to a rate-limited or locked response", () => {
    const failure = toFormError(new ApiError(429, "account_locked", "Слишком много попыток.", null, 600));
    expect(failure.message).toBe("Слишком много попыток. Повторить можно через 10 мин.");
    expect(toFormError(new ApiError(429, "rate_limited", "Подождите.", null, 30)).message).toContain("30 сек.");
  });

  it("keeps the field the server blames", () => {
    const failure = toFormError(new ApiError(422, "invalid", "Короткий пароль", "password"));
    expect(failure).toEqual({ message: "Короткий пароль", field: "password", code: "invalid" });
  });

  it("hides anything unexpected behind a generic message", () => {
    expect(toFormError(new Error("boom")).message).toBe("Что-то пошло не так. Попробуйте ещё раз.");
  });
});

describe("looksLikeEmail", () => {
  it("catches obvious typos only", () => {
    expect(looksLikeEmail(" name@example.com ")).toBe(true);
    expect(looksLikeEmail("name@example")).toBe(false);
    expect(looksLikeEmail("name example.com")).toBe(false);
  });
});

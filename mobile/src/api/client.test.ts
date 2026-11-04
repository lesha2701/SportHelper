import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { ApiError, apiRequest, onSessionExpired, parseResponse } from "./client";

jest.mock("./tokenStore", () => ({ getToken: jest.fn(async () => "tok123") }));

function respond(status: number, body: unknown): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("parseResponse", () => {
  it("returns the JSON body of a successful response", async () => {
    await expect(parseResponse(respond(200, { ok: 1 }))).resolves.toEqual({ ok: 1 });
  });

  it("builds an ApiError from the server's error body", async () => {
    const body = { error: { code: "account_locked", message: "Слишком много попыток", retry_after: 60 } };
    await expect(parseResponse(respond(429, body))).rejects.toMatchObject({
      status: 429,
      code: "account_locked",
      message: "Слишком много попыток",
      retryAfter: 60,
    });
  });

  it("explains FastAPI's own validation answer", async () => {
    await expect(parseResponse(respond(422, { detail: [{ loc: ["body", "x"], msg: "bad" }] }))).rejects.toMatchObject({ code: "validation_error", status: 422 });
  });

  it("falls back to a generic error for an unexpected body", async () => {
    await expect(parseResponse(respond(500, null))).rejects.toMatchObject({ code: "unknown_error", status: 500 });
  });
});

describe("apiRequest", () => {
  it("sends the stored token as a Bearer header and no cookies or CSRF", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(respond(200, { id: 1 }));

    await apiRequest("/api/auth/me");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok123");
    expect((init.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();
  });

  it("reports a network failure as ApiError(network_error)", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fail"));

    await expect(apiRequest("/api/x")).rejects.toBeInstanceOf(ApiError);
    await expect(apiRequest("/api/x")).rejects.toMatchObject({ code: "network_error" });
  });

  it("tells listeners the session ended on a 401, except for the sign-in form paths", async () => {
    const listener = jest.fn();
    const off = onSessionExpired(listener);
    jest.spyOn(globalThis, "fetch").mockImplementation(async () => respond(401, { error: { code: "unauthorized", message: "x" } }));

    await expect(apiRequest("/api/teams")).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);

    await expect(apiRequest("/api/auth/mobile/login", { method: "POST", body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});

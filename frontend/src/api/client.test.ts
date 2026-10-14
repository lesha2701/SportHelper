import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, apiUpload, onSessionExpired, setCsrfToken } from "./client";

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setCsrfToken(null);
});
afterEach(() => vi.unstubAllGlobals());

describe("how the browser authenticates", () => {
  it("always sends the cookie and never an Authorization header", async () => {
    fetchMock.mockImplementation(() => respond(200, { ok: true }));

    await apiRequest("/api/anything", { token: "ignored-legacy-argument" });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.credentials).toBe("include");
    expect(JSON.stringify(init.headers)).not.toContain("Authorization");
    expect(JSON.stringify(init.headers)).not.toContain("ignored-legacy-argument");
  });

  it("adds the CSRF token to changes but not to reads", async () => {
    setCsrfToken("csrf-123");
    fetchMock.mockImplementation(() => respond(200, {}));

    await apiRequest("/api/x");
    await apiRequest("/api/x", { method: "POST", body: { a: 1 } });
    await apiRequest("/api/x", { method: "DELETE" });

    const headers = fetchMock.mock.calls.map(([, init]) => init.headers as Record<string, string>);
    expect(headers[0]!["X-CSRF-Token"]).toBeUndefined();
    expect(headers[1]!["X-CSRF-Token"]).toBe("csrf-123");
    expect(headers[2]!["X-CSRF-Token"]).toBe("csrf-123");
  });

  it("uploads carry the cookie and the CSRF token too", async () => {
    setCsrfToken("csrf-up");
    fetchMock.mockImplementation(() => respond(200, {}));

    await apiUpload("/api/files", { formData: new FormData() });

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.credentials).toBe("include");
    expect(init.headers["X-CSRF-Token"]).toBe("csrf-up");
  });

  it("never touches localStorage or sessionStorage", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    fetchMock.mockImplementation(() => respond(200, {}));
    setCsrfToken("secret-ish");

    await apiRequest("/api/x", { method: "POST" });

    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });
});

describe("errors", () => {
  it("exposes the field and retry-after the server reports", async () => {
    fetchMock.mockReturnValue(
      respond(422, { error: { code: "password_too_short", message: "Короткий", field: "password", retry_after: 12 } }),
    );

    const error = await apiRequest("/api/auth/register", { method: "POST", silent: true }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 422, code: "password_too_short", field: "password", retryAfter: 12 });
  });

  it("reports a missing connection as a status-0 error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(apiRequest("/api/x", { silent: true })).rejects.toMatchObject({ status: 0, code: "network_error" });
  });
});

describe("a session that ended", () => {
  it("notifies the app on a 401 from a normal request", async () => {
    const listener = vi.fn();
    const off = onSessionExpired(listener);
    fetchMock.mockImplementation(() => respond(401, { error: { code: "unauthorized", message: "authentication required" } }));

    await apiRequest("/api/teams/mine").catch(() => {});

    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it("does not treat a failed login/registration/me check as an expired session", async () => {
    const listener = vi.fn();
    const off = onSessionExpired(listener);
    fetchMock.mockImplementation(() => respond(401, { error: { code: "invalid_credentials", message: "Неверный email или пароль." } }));

    await apiRequest("/api/auth/login", { method: "POST", silent: true }).catch(() => {});
    await apiRequest("/api/auth/me", { silent: true }).catch(() => {});

    expect(listener).not.toHaveBeenCalled();
    off();
  });
});

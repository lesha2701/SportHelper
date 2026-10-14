import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as authApi from "../api/auth";
import { ApiError, apiRequest, setCsrfToken } from "../api/client";
import type { User } from "../types/user";
import { AuthProvider, useAuth } from "./AuthContext";

vi.mock("../api/auth", () => ({ fetchMe: vi.fn(), logout: vi.fn() }));
const api = vi.mocked(authApi);

const alice = { id: "u1", firstName: "Алиса", email: "alice@example.com" } as User;
let auth: ReturnType<typeof useAuth>;

function Probe() {
  auth = useAuth();
  const { state } = auth;
  return <div data-testid="state">{state.status === "guest" ? `guest:${state.sessionExpired}` : state.status}</div>;
}

const mount = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
const status = () => screen.getByTestId("state").textContent;

beforeEach(() => {
  vi.clearAllMocks();
  setCsrfToken(null);
});
afterEach(cleanup);

describe("session bootstrap", () => {
  it("restores the signed-in user from the session cookie after a reload", async () => {
    api.fetchMe.mockResolvedValue({ user: alice, csrfToken: "csrf-1" });

    mount();

    expect(status()).toBe("loading");
    await waitFor(() => expect(status()).toBe("ready"));
    expect(auth.state).toMatchObject({ status: "ready", user: alice });
  });

  it("starts as a guest when there is no (valid) session", async () => {
    api.fetchMe.mockRejectedValue(new ApiError(401, "unauthorized", "authentication required"));

    mount();

    await waitFor(() => expect(status()).toBe("guest:false"));
  });

  it("distinguishes 'server unreachable' from 'not signed in'", async () => {
    api.fetchMe.mockRejectedValue(new ApiError(0, "network_error", "Не удалось связаться с сервером"));

    mount();

    await waitFor(() => expect(status()).toBe("error"));
  });

  it("stores nothing secret in the browser", async () => {
    const write = vi.spyOn(Storage.prototype, "setItem");
    api.fetchMe.mockResolvedValue({ user: alice, csrfToken: "csrf-secret" });

    mount();
    await waitFor(() => expect(status()).toBe("ready"));

    expect(write).not.toHaveBeenCalled();
    expect(JSON.stringify(Object.assign({}, window.localStorage, window.sessionStorage))).not.toContain("csrf-secret");
    write.mockRestore();
  });
});

describe("while signed in", () => {
  it("falls back to the public site (and says why) when a request finds the session gone", async () => {
    api.fetchMe.mockResolvedValue({ user: alice, csrfToken: "csrf-1" });
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: { code: "unauthorized", message: "x" } }), { status: 401 }))));
    mount();
    await waitFor(() => expect(status()).toBe("ready"));

    await act(async () => {
      await apiRequest("/api/teams/mine", { silent: true }).catch(() => {});
    });

    expect(status()).toBe("guest:true");
    vi.unstubAllGlobals();
  });

  it("logging out ends the session on the server and returns to guest", async () => {
    api.fetchMe.mockResolvedValue({ user: alice, csrfToken: "csrf-1" });
    api.logout.mockResolvedValue(undefined);
    mount();
    await waitFor(() => expect(status()).toBe("ready"));

    await act(async () => {
      await auth.logout();
    });

    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(status()).toBe("guest:false");
  });

  it("still signs out locally if the server cannot be reached", async () => {
    api.fetchMe.mockResolvedValue({ user: alice, csrfToken: "csrf-1" });
    api.logout.mockRejectedValue(new ApiError(0, "network_error", "offline"));
    mount();
    await waitFor(() => expect(status()).toBe("ready"));

    await act(async () => {
      await auth.logout();
    });

    expect(status()).toBe("guest:false");
  });

  it("signIn adopts a login result without another request", async () => {
    api.fetchMe.mockRejectedValue(new ApiError(401, "unauthorized", "x"));
    mount();
    await waitFor(() => expect(status()).toBe("guest:false"));

    act(() => auth.signIn({ user: alice, csrfToken: "csrf-2" }));

    expect(status()).toBe("ready");
    expect(api.fetchMe).toHaveBeenCalledTimes(1);
  });

  it("updateUser merges a changed profile into the live session", async () => {
    api.fetchMe.mockResolvedValue({ user: alice, csrfToken: "csrf-1" });
    mount();
    await waitFor(() => expect(status()).toBe("ready"));

    act(() => auth.updateUser({ ...alice, firstName: "Алисия" }));

    expect(auth.state).toMatchObject({ user: { firstName: "Алисия" } });
  });
});

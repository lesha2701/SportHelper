import { afterEach, describe, expect, it } from "vitest";
import { loginUrl, navigate, registerUrl, safeNext } from "./router";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("safeNext (the only thing that decides where login sends you)", () => {
  it("accepts same-site paths, with query strings", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/coaches?listing=1")).toBe("/coaches?listing=1");
    expect(safeNext("/?book=abc-123")).toBe("/?book=abc-123");
  });

  it.each([
    ["an absolute URL", "https://evil.example/"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", "profile"],
    ["a header-injection attempt", "/ok\r\nSet-Cookie: x=1"],
    ["empty", ""],
    ["null", null],
  ])("rejects %s", (_name, value) => {
    expect(safeNext(value as string | null)).toBeNull();
  });
});

describe("login and register URLs", () => {
  it("carry the destination so it survives sign-in and sign-up", () => {
    expect(loginUrl("/?book=42")).toBe("/login?next=%2F%3Fbook%3D42");
    expect(registerUrl("/coaches?listing=7")).toBe("/register?next=%2Fcoaches%3Flisting%3D7");
  });

  it("drop an unsafe or trivial destination", () => {
    expect(loginUrl("https://evil.example")).toBe("/login");
    expect(loginUrl("/")).toBe("/login");
    expect(loginUrl(null)).toBe("/login");
  });
});

describe("navigate", () => {
  it("pushes a same-origin path and tells subscribers", () => {
    navigate("/login?next=%2F");
    expect(window.location.pathname + window.location.search).toBe("/login?next=%2F");
  });

  it("can replace instead of pushing", () => {
    const before = window.history.length;
    navigate("/register", { replace: true });
    expect(window.location.pathname).toBe("/register");
    expect(window.history.length).toBe(before);
  });
});

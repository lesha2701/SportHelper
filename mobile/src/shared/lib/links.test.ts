import { describe, expect, it } from "@jest/globals";
import { extractToken } from "./links";

describe("extractToken", () => {
  it("takes the token out of a pasted link", () => {
    expect(extractToken("https://sportarena.ru/verify-email?token=abc_DEF-123&next=%2Fteams")).toBe("abc_DEF-123");
    expect(extractToken("  http://localhost:5173/reset-password?token=xyz#top ")).toBe("xyz");
  });

  it("accepts a bare token", () => {
    expect(extractToken("  abc123 ")).toBe("abc123");
  });
});

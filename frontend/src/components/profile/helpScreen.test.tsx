import { describe, expect, it } from "vitest";
import { capitalized } from "../../lib/capitalized";

describe("the explanations in the help", () => {
  it("begin with a capital letter", () => {
    expect(capitalized("участники, их роли")).toBe("Участники, их роли");
    expect(capitalized("Уже с заглавной")).toBe("Уже с заглавной");
    expect(capitalized("")).toBe("");
  });
});

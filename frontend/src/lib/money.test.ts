import { describe, expect, it } from "vitest";
import { formatKopecks, parseRubles } from "./money";

describe("money on the screen", () => {
  it("formats kopecks as roubles", () => {
    expect(formatKopecks(180000).replace(/\s/g, " ")).toBe("1 800,00 ₽");
    expect(formatKopecks(5).replace(/\s/g, " ")).toBe("0,05 ₽");
    expect(formatKopecks(1080000).replace(/\s/g, " ")).toBe("10 800,00 ₽");
  });

  it("reads an amount typed by a person into exact kopecks", () => {
    expect(parseRubles("10 000")).toBe(1000000);
    expect(parseRubles("1500,5")).toBe(150050);
    expect(parseRubles("1500.50")).toBe(150050);
    expect(parseRubles("0,01")).toBe(1);
    expect(parseRubles("19999.99")).toBe(1999999);
  });

  it("refuses anything that is not a plain positive amount", () => {
    for (const bad of ["", "abc", "-5", "0", "0,00", "1,234", "1e5", "10 000 ₽", "1,2,3", "9999999999"]) expect(parseRubles(bad)).toBeNull();
  });
});

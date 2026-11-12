import { describe, expect, it } from "@jest/globals";
import { joinTournamentLines, matchPlaceFor, parseTournamentLines } from "./tournaments";

describe("the tournaments of a team, one per line", () => {
  it("drops blank lines, trims names and keeps each once", () => {
    expect(parseTournamentLines("  Осенний кубок \n\nПервенство города\nОсенний кубок\n   ")).toEqual(["Осенний кубок", "Первенство города"]);
    expect(parseTournamentLines("")).toEqual([]);
  });

  it("writes them back one per line", () => {
    expect(joinTournamentLines(["А", "Б"])).toBe("А\nБ");
    expect(joinTournamentLines([])).toBe("");
  });
});

describe("the place a new match starts with", () => {
  it("is the home venue for a home game and empty away", () => {
    expect(matchPlaceFor(true, "Стадион «Заря»")).toBe("Стадион «Заря»");
    expect(matchPlaceFor(false, "Стадион «Заря»")).toBe("");
  });

  it("is empty when the team has no home venue", () => {
    expect(matchPlaceFor(true, null)).toBe("");
  });
});

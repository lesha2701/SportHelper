import { describe, expect, it } from "@jest/globals";
import { emptyLibraryText, isLibraryOwner, libraryNoun } from "./teamLibrary";

describe("the materials of a team", () => {
  it("names what is listed", () => {
    expect(libraryNoun("exercises")).toBe("упражнения");
    expect(libraryNoun("plans")).toBe("планы");
  });

  it("tells a coach how to fill an empty list and a player to wait", () => {
    expect(emptyLibraryText("exercises", true)).toEqual({ title: "Упражнений нет", hint: "Откройте команде свои упражнения кнопкой выше — игроки увидят их здесь." });
    expect(emptyLibraryText("plans", false)).toEqual({ title: "Планов нет", hint: "Тренер ещё не открыл команде ни одного плана." });
    expect(emptyLibraryText("exercises", false).hint).toBe("Тренер ещё не открыл команде ни одного упражнения.");
  });

  it("gives the owner's tools only to the author", () => {
    expect(isLibraryOwner("u1", "u1")).toBe(true);
    expect(isLibraryOwner("u2", "u1")).toBe(false);
    expect(isLibraryOwner(null, "u1")).toBe(false);
    expect(isLibraryOwner(undefined, "u1")).toBe(false);
  });
});

import { describe, expect, it } from "@jest/globals";
import { count, pluralize, years } from "./plural";

describe("Russian number agreement", () => {
  it("picks the form by the last digits, with 11-14 always in the plural", () => {
    const forms = [0, 1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111, 112].map((n) => years(n));

    expect(forms).toEqual([
      "0 лет",
      "1 год",
      "2 года",
      "4 года",
      "5 лет",
      "11 лет",
      "12 лет",
      "14 лет",
      "21 год",
      "22 года",
      "25 лет",
      "101 год",
      "111 лет",
      "112 лет",
    ]);
  });

  it("works for any noun", () => {
    expect(count(1, "отзыв", "отзыва", "отзывов")).toBe("1 отзыв");
    expect(count(3, "отзыв", "отзыва", "отзывов")).toBe("3 отзыва");
    expect(count(7, "отзыв", "отзыва", "отзывов")).toBe("7 отзывов");
    expect(pluralize(22, "игрок", "игрока", "игроков")).toBe("игрока");
  });
});

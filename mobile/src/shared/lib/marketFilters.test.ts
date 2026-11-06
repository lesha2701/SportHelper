import { describe, expect, it } from "@jest/globals";
import { activeCount, EMPTY_FILTERS, toQuery } from "./marketFilters";

describe("coach catalogue filters", () => {
  it("sends only what is set", () => {
    expect(toQuery(EMPTY_FILTERS)).toEqual({});
    expect(
      toQuery({ sport: "Футбол", city: " Москва ", minPrice: "1 000", maxPrice: "2500", minRating: 4.5, onlineOnly: true }),
    ).toEqual({ sport: "Футбол", location: "Москва", min_price: 1000, max_price: 2500, min_rating: 4.5, format: "online" });
  });

  it("ignores a price that is not a number", () => {
    expect(toQuery({ ...EMPTY_FILTERS, minPrice: "дёшево", maxPrice: "-5" })).toEqual({});
  });

  it("counts the filters that are on, the price range as one", () => {
    expect(activeCount(EMPTY_FILTERS)).toBe(0);
    expect(activeCount({ ...EMPTY_FILTERS, sport: "Бокс" })).toBe(0);
    expect(activeCount({ ...EMPTY_FILTERS, city: "Казань", minPrice: "500", maxPrice: "900", onlineOnly: true })).toBe(3);
  });
});

import type { CoachListingFilters } from "../types/coachListing";

/** What the person set in the coach catalogue's filters, as typed (text fields stay text until applied). */
export interface MarketFilterForm {
  sport: string;
  city: string;
  minPrice: string;
  maxPrice: string;
  minRating: number | null;
  onlineOnly: boolean;
}

export const EMPTY_FILTERS: MarketFilterForm = { sport: "", city: "", minPrice: "", maxPrice: "", minRating: null, onlineOnly: false };

function price(text: string): number | undefined {
  const n = Number(text.replace(/\s/g, "").replace(",", "."));
  return text.trim() && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/** The query for /api/coach-listings: only what is set; nonsense in a price field is ignored rather than sent. */
export function toQuery(form: MarketFilterForm): CoachListingFilters {
  const q: CoachListingFilters = {};
  if (form.sport) q.sport = form.sport;
  if (form.city.trim()) q.location = form.city.trim();
  const min = price(form.minPrice);
  const max = price(form.maxPrice);
  if (min !== undefined) q.min_price = min;
  if (max !== undefined) q.max_price = max;
  if (form.minRating !== null) q.min_rating = form.minRating;
  if (form.onlineOnly) q.format = "online";
  return q;
}

/** How many filters are on (the sport has its own control, so it is not counted). */
export function activeCount(form: MarketFilterForm): number {
  const q = toQuery({ ...form, sport: "" });
  return [q.location, q.min_price !== undefined || q.max_price !== undefined ? 1 : undefined, q.min_rating, q.format].filter((v) => v !== undefined).length;
}

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getListingOpenSlots } from "../../api/coachListings";
import { createBooking } from "../../api/bookings";
import type { CoachListingProfile } from "../../types/coachListing";
import { localDateKey } from "../../lib/localDate";
import { BookingFlow } from "./BookingFlow";

vi.mock("../../api/coachListings", () => ({ getListingOpenSlots: vi.fn() }));
vi.mock("../../api/bookings", () => ({ createBooking: vi.fn() }));

const dayPlus = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return localDateKey(d);
};
const listing = {
  id: "L1", title: "Теннис", coachFullName: "Алиса", offersOnline: true, offersOffline: false, pricePerSession: 2500, currency: "RUB",
  location: null,
} as unknown as CoachListingProfile;

// Free time exists only on day +40 (10:00 and 11:00): far outside the 14-day strip.
const FAR = dayPlus(40);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getListingOpenSlots).mockImplementation(async (_t, _l, from, to) =>
    from <= FAR && FAR <= to
      ? [{ startsAt: `${FAR}T10:00:00Z`, durationMinutes: 60 }, { startsAt: `${FAR}T11:00:00Z`, durationMinutes: 60 }]
      : [],
  );
});
afterEach(cleanup);

const open = () => render(<BookingFlow token="t" listing={listing} onBack={() => {}} onBooked={() => {}} />);

describe("choosing a date in the booking flow", () => {
  it("jumps to a date picked in the calendar and shows that day's free slots at once", async () => {
    open();
    await screen.findByText(/нет свободных слотов/);

    fireEvent.change(screen.getByLabelText("Выбрать дату"), { target: { value: FAR } });

    expect(await screen.findByText("10:00")).toBeTruthy();
    expect(screen.getByText("11:00")).toBeTruthy();
    expect(vi.mocked(getListingOpenSlots)).toHaveBeenLastCalledWith("t", "L1", FAR, FAR);
  });

  it("offers the nearest days with free time when the chosen day is empty, and opens one on a click", async () => {
    open();
    await screen.findByText(/нет свободных слотов/);

    const nearest = await screen.findByRole("button", { name: /^\S+, \d+ \S+$/ }); // «вс, 27 декабря»
    fireEvent.click(nearest);

    expect(await screen.findByText("10:00")).toBeTruthy();
  });

  it("says so when there is nothing in the next three months", async () => {
    vi.mocked(getListingOpenSlots).mockResolvedValue([]);
    open();

    expect(await screen.findByText(/свободного времени у тренера нет/)).toBeTruthy();
  });

  it("ignores a date in the past typed into the field", async () => {
    open();
    await screen.findByText(/нет свободных слотов/);
    const calls = vi.mocked(getListingOpenSlots).mock.calls.length;

    fireEvent.change(screen.getByLabelText("Выбрать дату"), { target: { value: dayPlus(-3) } });

    await waitFor(() => expect(vi.mocked(getListingOpenSlots).mock.calls.length).toBe(calls));
  });
});

describe("sending a booking request", () => {
  it("asks only for a time: no wishes field, and the request goes out without notes", async () => {
    vi.mocked(createBooking).mockResolvedValue({} as never);
    open();
    await screen.findByText(/нет свободных слотов/);
    fireEvent.change(screen.getByLabelText("Выбрать дату"), { target: { value: FAR } });
    fireEvent.click(await screen.findByText("10:00"));

    expect(screen.queryByText(/Пожелания/)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить запись" }));
    await waitFor(() => expect(vi.mocked(createBooking)).toHaveBeenCalled());
    expect(vi.mocked(createBooking).mock.calls[0]?.[1]).toMatchObject({ listing_id: "L1", starts_at: `${FAR}T10:00:00Z`, athlete_notes: null });
  });
});

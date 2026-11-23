import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listCoachPendingBookings } from "../../api/bookings";
import { mapPendingBookingDto } from "../../types/booking";
import { IncomingBookingsScreen } from "./IncomingBookingsScreen";
import { MatchBookingNote } from "./MatchBookingNote";

vi.mock("../../api/bookings", () => ({ confirmBooking: vi.fn(), declineBooking: vi.fn(), listCoachPendingBookings: vi.fn() }));
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ state: { status: "ready", user: { id: "me" } } }) }));

const dto = (over: Record<string, unknown> = {}) => ({
  id: "b1", listing_title: "Тренировки", athlete_user_id: "a1", athlete_full_name: "Спортсмен из подбора", athlete_notes: null,
  starts_at: "2026-10-12T10:00:00Z", duration_minutes: 60, format: "online", price_per_session: 2500, currency: "RUB",
  created_at: "2026-10-06T10:00:00Z", athlete_rating_average: null, athlete_review_count: 0, ...over,
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(listCoachPendingBookings).mockReset();
});
afterEach(cleanup);

describe("a client from «Подобрать тренера» on the trainer's screens", () => {
  it("maps the matching fields, with safe defaults for an ordinary booking", () => {
    expect(mapPendingBookingDto(dto({ from_match: true, match_percent: 50, athlete_hidden: true }))).toMatchObject({ fromMatch: true, matchPercent: 50, athleteHidden: true });
    expect(mapPendingBookingDto(dto())).toMatchObject({ fromMatch: false, matchPercent: null, athleteHidden: false });
  });

  it("shows no profile link while the name is hidden, and says what opens after payment", async () => {
    vi.mocked(listCoachPendingBookings).mockResolvedValue([mapPendingBookingDto(dto({ from_match: true, match_percent: 50, athlete_hidden: true }))]);
    render(<IncomingBookingsScreen token="t" onBack={() => {}} />);
    await act(async () => {});

    expect(screen.getByText("Спортсмен из подбора")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Спортсмен из подбора" })).toBeNull();
    expect(screen.getByText(/имя и контакты откроются после оплаты первой тренировки/)).toBeTruthy();
    expect(screen.getByText(/удерживает 50%/)).toBeTruthy();
  });

  it("keeps the name a link for an ordinary request", async () => {
    vi.mocked(listCoachPendingBookings).mockResolvedValue([mapPendingBookingDto(dto({ athlete_full_name: "Игорь" }))]);
    render(<IncomingBookingsScreen token="t" onBack={() => {}} />);
    await act(async () => {});

    expect(screen.getByRole("button", { name: "Игорь" })).toBeTruthy();
    expect(screen.queryByText(/из подбора/)).toBeNull();
  });
});

describe("the note under a booking", () => {
  it("tells the athlete the first session is paid in the app until it is paid", () => {
    const { rerender, container } = render(<MatchBookingNote side="athlete" fromMatch />);
    expect(screen.getByText(/оплачивается в приложении/)).toBeTruthy();
    rerender(<MatchBookingNote side="athlete" fromMatch paid />);
    expect(container.textContent).toBe("");
  });

  it("is silent for an ordinary booking and states the share for the trainer after payment", () => {
    const { rerender, container } = render(<MatchBookingNote side="coach" fromMatch={false} />);
    expect(container.textContent).toBe("");
    rerender(<MatchBookingNote side="coach" fromMatch percent={50} />);
    expect(screen.getByText(/Клиент из подбора\. Платформа удерживает 50%/)).toBeTruthy();
  });
});

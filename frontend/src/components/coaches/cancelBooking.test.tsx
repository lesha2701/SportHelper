import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cancelBooking, getCancelPreview, listCoachBookings, listMyBookings } from "../../api/bookings";
import { ApiError } from "../../api/client";
import type { Booking, CancelPreview, Cancellation } from "../../types/booking";
import { CancelBooking, CancellationNote } from "./CancelBooking";
import { CoachBookingsSection } from "./CoachBookingsSection";
import { MyBookingsSection } from "./MyBookingsSection";

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ state: { status: "ready", user: { id: "me" } } }) }));
vi.mock("../../hooks/useChatUnread", () => ({ useChatUnread: () => ({ unread: { booking: {}, team: {}, total: 0 }, refresh: () => {} }) }));
vi.mock("../../features", () => ({ usePaymentsEnabled: () => true }));
vi.mock("../../api/payments", () => ({ startBookingPayment: vi.fn(), syncBookingPayment: vi.fn(), openPaymentPage: vi.fn() }));
vi.mock("../../api/bookings", () => ({
  listMyBookings: vi.fn(),
  listCoachBookings: vi.fn(),
  getCancelPreview: vi.fn(),
  cancelBooking: vi.fn(),
  reviewBooking: vi.fn(),
  reviewPlayer: vi.fn(),
  completeBookingSession: vi.fn(),
}));
vi.mock("../trainings/TrainingDetail", () => ({ TrainingDetail: () => <div>TRAINING</div> }));

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: "b1", coachUserId: "c1", coachFullName: "Тренер Анна", listingId: "l1", listingTitle: "Теннис для взрослых", athleteUserId: "a1",
  athleteFullName: "Игорь", athleteNotes: null, startsAt: "2026-11-20T10:00:00Z", durationMinutes: 60, format: "online",
  pricePerSession: 2500, currency: "RUB", status: "confirmed", isCompleted: false, trainingId: "t-77", trainingPlanId: null,
  trainingPlanName: null, trainingStatus: "scheduled", hasReview: false, hasPlayerReview: false, paymentStatus: "paid", paidAt: null,
  canCancel: true, cancellation: null,
  ...overrides,
});

const preview = (overrides: Partial<CancelPreview> = {}): CancelPreview => ({
  policy: "athlete_early", hoursBeforeStart: 48, freeCancelUntil: "2026-11-19T10:00:00Z", paidKopecks: 250000, refundPercent: 100, refundKopecks: 250000,
  trainerKeepsPayment: false, ...overrides,
});

const cancellation = (overrides: Partial<Cancellation> = {}): Cancellation => ({
  cancelledByRole: "athlete", cancelledAt: "2026-11-18T09:00:00Z", reason: null, policy: "athlete_early", refundPercent: 100,
  refundAmountKopecks: 250000, refundStatus: "pending", ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Отменить запись" }));
  await act(async () => {});
};

describe("the cancel button", () => {
  it("is only there when the server says the booking can be cancelled", () => {
    const { rerender } = render(<CancelBooking token="t" booking={booking({ canCancel: false })} side="athlete" onCancelled={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<CancelBooking token="t" booking={booking()} side="athlete" onCancelled={() => {}} />);
    expect(screen.getByRole("button", { name: "Отменить запись" })).toBeTruthy();
  });

  it("tells the athlete about a full refund BEFORE asking to confirm, then cancels", async () => {
    vi.mocked(getCancelPreview).mockResolvedValue(preview());
    const done = booking({ status: "cancelled", canCancel: false, cancellation: cancellation() });
    vi.mocked(cancelBooking).mockResolvedValue(done);
    const onCancelled = vi.fn();
    render(<CancelBooking token="t" booking={booking()} side="athlete" onCancelled={onCancelled} />);

    await open();

    expect(screen.getByText(/Вернём 100% — 2\s?500/)).toBeTruthy();
    expect(cancelBooking).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Заболел " } });
    fireEvent.click(screen.getAllByRole("button", { name: "Отменить запись" }).at(-1)!);
    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(done));
    expect(cancelBooking).toHaveBeenCalledWith("t", "b1", "Заболел");
  });

  it("warns the athlete that a late cancellation returns nothing", async () => {
    vi.mocked(getCancelPreview).mockResolvedValue(preview({ policy: "athlete_late", refundPercent: 0, refundKopecks: 0, trainerKeepsPayment: true }));
    render(<CancelBooking token="t" booking={booking()} side="athlete" onCancelled={() => {}} />);

    await open();

    expect(screen.getByText(/Деньги не вернутся: оплата остаётся у тренера/)).toBeTruthy();
  });

  it("says that nothing was charged for an unpaid booking", async () => {
    vi.mocked(getCancelPreview).mockResolvedValue(preview({ policy: "unpaid", refundPercent: 0, refundKopecks: 0, paidKopecks: 0, freeCancelUntil: null }));
    render(<CancelBooking token="t" booking={booking({ paymentStatus: "unpaid" })} side="athlete" onCancelled={() => {}} />);

    await open();

    expect(screen.getByText(/деньги не списывались/)).toBeTruthy();
  });

  it("does not let the coach cancel without a reason, and sends it when given", async () => {
    vi.mocked(getCancelPreview).mockResolvedValue(preview({ policy: "coach" }));
    vi.mocked(cancelBooking).mockResolvedValue(booking({ status: "cancelled", canCancel: false, cancellation: cancellation({ cancelledByRole: "coach", policy: "coach" }) }));
    const onCancelled = vi.fn();
    render(<CancelBooking token="t" booking={booking()} side="coach" onCancelled={onCancelled} />);

    await open();
    expect(screen.getByText(/Игрок получит полный возврат — 2\s?500/)).toBeTruthy();
    const confirm = () => fireEvent.click(screen.getAllByRole("button", { name: "Отменить запись" }).at(-1)!);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "ab" } });
    confirm();
    expect(screen.getByText(/Укажите причину отмены/)).toBeTruthy();
    expect(cancelBooking).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Травма" } });
    confirm();
    await waitFor(() => expect(onCancelled).toHaveBeenCalled());
    expect(cancelBooking).toHaveBeenCalledWith("t", "b1", "Травма");
  });

  it("keeps the window open with the server's words when the cancellation is refused", async () => {
    vi.mocked(getCancelPreview).mockResolvedValue(preview());
    vi.mocked(cancelBooking).mockRejectedValue(new ApiError(409, "session_started", "Занятие уже началось — отменить его нельзя."));
    const onCancelled = vi.fn();
    render(<CancelBooking token="t" booking={booking()} side="athlete" onCancelled={onCancelled} />);

    await open();
    fireEvent.click(screen.getAllByRole("button", { name: "Отменить запись" }).at(-1)!);

    expect(await screen.findByText("Занятие уже началось — отменить его нельзя.")).toBeTruthy();
    expect(onCancelled).not.toHaveBeenCalled();
  });

  it("offers no confirmation when the conditions could not be worked out", async () => {
    vi.mocked(getCancelPreview).mockRejectedValue(new ApiError(409, "session_started", "Занятие уже началось — отменить его нельзя."));
    render(<CancelBooking token="t" booking={booking()} side="athlete" onCancelled={() => {}} />);

    await open();

    expect(await screen.findByText("Занятие уже началось — отменить его нельзя.")).toBeTruthy();
    expect((screen.getAllByRole("button", { name: "Отменить запись" }).at(-1) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("the card of a cancelled booking", () => {
  it("shows who cancelled, why, and where the money is, from each side", () => {
    const { rerender } = render(<CancellationNote cancellation={cancellation({ cancelledByRole: "coach", reason: "Травма", policy: "coach" })} side="athlete" />);
    expect(screen.getByText(/Отменена тренером/)).toBeTruthy();
    expect(screen.getByText("Причина: Травма")).toBeTruthy();
    expect(screen.getByText(/Возврат 2\s?500.* обрабатывается/)).toBeTruthy();

    rerender(<CancellationNote cancellation={cancellation({ refundStatus: "succeeded" })} side="athlete" />);
    expect(screen.getByText(/Отменена вами/)).toBeTruthy();
    expect(screen.getByText(/Возвращено 2\s?500/)).toBeTruthy();

    rerender(<CancellationNote cancellation={cancellation({ policy: "athlete_late", refundPercent: 0, refundAmountKopecks: 0, refundStatus: "none" })} side="coach" />);
    expect(screen.getByText(/Отменена игроком/)).toBeTruthy();
    expect(screen.getByText(/оплата осталась у вас/)).toBeTruthy();

    rerender(<CancellationNote cancellation={cancellation({ refundStatus: "failed" })} side="athlete" />);
    expect(screen.getByText(/Банк не принял возврат/)).toBeTruthy();
  });

  it("says nothing about money when nothing was paid", () => {
    render(<CancellationNote cancellation={cancellation({ policy: "unpaid", refundPercent: 0, refundAmountKopecks: 0, refundStatus: "none" })} side="athlete" />);
    expect(screen.queryByText(/Возврат|Деньги|Возвращено/)).toBeNull();
  });

  it("tells about a payment made after the cancellation and returned by itself", () => {
    const paidLater = cancellation({ policy: "unpaid", refundPercent: 0, refundAmountKopecks: 250000, refundStatus: "pending" });
    const { rerender } = render(<CancellationNote cancellation={paidLater} side="athlete" />);
    expect(screen.getByText(/Возврат 2\s?500.* обрабатывается/)).toBeTruthy();
    rerender(<CancellationNote cancellation={paidLater} side="coach" />);
    expect(screen.getByText(/Игроку возвращается 2\s?500/)).toBeTruthy();
  });

  it("shows the moment of the cancellation in the reader's own time (it is a real moment, not a session's wall-clock time)", () => {
    const at = "2026-11-11T07:48:00Z";
    render(<CancellationNote cancellation={cancellation({ cancelledAt: at })} side="athlete" />);
    const local = new Date(at).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    expect(screen.getByText(`Отменена вами · ${local}`)).toBeTruthy();
  });
});

describe("the lists", () => {
  it("move a booking to «Отменённые» right after the athlete cancels it", async () => {
    vi.mocked(listMyBookings).mockResolvedValue([booking()]);
    vi.mocked(getCancelPreview).mockResolvedValue(preview());
    vi.mocked(cancelBooking).mockResolvedValue(booking({ status: "cancelled", canCancel: false, cancellation: cancellation() }));
    render(<MyBookingsSection token="t" onBack={() => {}} />);
    await act(async () => {});
    expect(screen.queryByText("Отменённые")).toBeNull();

    await open();
    fireEvent.click(screen.getAllByRole("button", { name: "Отменить запись" }).at(-1)!);

    expect(await screen.findByText("Отменённые")).toBeTruthy();
    expect(screen.getByText("Отменена")).toBeTruthy();
    expect(screen.getByText(/Отменена вами/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Отменить запись" })).toBeNull();
  });

  it("show a booking cancelled by the athlete in the coach's list with the money line", async () => {
    vi.mocked(listCoachBookings).mockResolvedValue([
      booking({ status: "cancelled", canCancel: false, cancellation: cancellation({ policy: "athlete_late", refundPercent: 0, refundAmountKopecks: 0, refundStatus: "none" }) }),
    ]);
    render(<CoachBookingsSection token="t" onBack={() => {}} />);
    await act(async () => {});

    expect(screen.getByText("Отменённые")).toBeTruthy();
    expect(screen.getByText("Отменена игроком", { selector: "span" })).toBeTruthy();
    expect(screen.getByText(/оплата осталась у вас/)).toBeTruthy();
    expect(screen.queryByText("Предстоящие")?.nextElementSibling?.textContent ?? "").not.toContain("Игорь");
  });
});

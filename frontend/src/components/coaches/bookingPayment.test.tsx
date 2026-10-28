import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listMyBookings } from "../../api/bookings";
import { openPaymentPage, rememberPaymentTrip, startBookingPayment, syncBookingPayment, takePaymentTrip } from "../../api/payments";
import { ApiError } from "../../api/client";
import type { Booking } from "../../types/booking";
import { BookingPayment } from "./BookingPayment";
import { MyBookingsSection } from "./MyBookingsSection";

let paymentsOn = true;
vi.mock("../../features", () => ({ usePaymentsEnabled: () => paymentsOn }));
vi.mock("../../api/payments", () => ({
  startBookingPayment: vi.fn(),
  syncBookingPayment: vi.fn(),
  openPaymentPage: vi.fn(),
  rememberPaymentTrip: vi.fn(),
  takePaymentTrip: vi.fn(() => null),
}));
vi.mock("../../api/bookings", () => ({ listMyBookings: vi.fn(), listCoachBookings: vi.fn(), reviewBooking: vi.fn(), reviewPlayer: vi.fn(), completeBooking: vi.fn(), getCoachBookingForTraining: vi.fn() }));
vi.mock("../trainings/TrainingDetail", () => ({
  TrainingDetail: ({ trainingId }: { trainingId: string }) => <div>TRAINING SCREEN {trainingId}</div>,
}));

const booking = (overrides: Partial<Booking> = {}): Booking => ({
  id: "b1", coachUserId: "c1", coachFullName: "Тренер Анна", listingId: "l1", listingTitle: "Теннис для взрослых", athleteUserId: "a1",
  athleteFullName: "Игорь", athleteNotes: null, startsAt: "2026-10-12T10:00:00Z", durationMinutes: 60, format: "online",
  pricePerSession: 2500, currency: "RUB", status: "confirmed", isCompleted: false, trainingId: "t-77", trainingPlanId: null,
  trainingPlanName: null, trainingStatus: "scheduled", hasReview: false, hasPlayerReview: false, paymentStatus: "unpaid", paidAt: null,
  ...overrides,
});

const flush = () => act(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  paymentsOn = true;
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(takePaymentTrip).mockReturnValue(null);
});
afterEach(cleanup);

describe("the pay button", () => {
  it("appears on a confirmed, unpaid booking with the price and the agent notice", () => {
    render(<BookingPayment token="t" booking={booking()} />);

    expect(screen.getByRole("button", { name: "Оплатить эту тренировку" })).toBeTruthy();
    expect(screen.getByText(/К оплате: 2\s?500/)).toBeTruthy();
    expect(
      screen.getByText(/Нажимая «Оплатить», вы заключаете договор с Тренером на/, { exact: false }).textContent,
    ).toContain("Платформа принимает оплату как агент Тренера и не является исполнителем услуги.");
    const terms = screen.getByRole("link", { name: "Типовых условиях оказания услуг тренером" });
    expect(terms.getAttribute("href")).toBe("/service-terms");
    expect(terms.getAttribute("target")).toBe("_blank");
  });

  it("is not offered before the coach confirms, for a free session, or while the shop is not connected", () => {
    const { rerender } = render(<BookingPayment token="t" booking={booking({ status: "pending" })} />);
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<BookingPayment token="t" booking={booking({ paymentStatus: "not_required", pricePerSession: null })} />);
    expect(screen.queryByRole("button")).toBeNull();

    paymentsOn = false;
    rerender(<BookingPayment token="t" booking={booking()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is replaced by «Оплачено» once paid", () => {
    render(<BookingPayment token="t" booking={booking({ paymentStatus: "paid", paidAt: "2026-10-10T10:00:00Z" })} />);

    expect(screen.getByText(/Оплачено/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Оплатить эту тренировку" })).toBeNull();
  });

  it("sends the person to the payment page the server returned", async () => {
    vi.mocked(startBookingPayment).mockResolvedValue({ confirmationUrl: "https://yoomoney.ru/checkout/pay" });
    render(<BookingPayment token="t" booking={booking()} />);

    fireEvent.click(screen.getByRole("button", { name: "Оплатить эту тренировку" }));

    await waitFor(() => expect(openPaymentPage).toHaveBeenCalledWith("https://yoomoney.ru/checkout/pay"));
    expect(startBookingPayment).toHaveBeenCalledWith("t", "b1");
    expect(rememberPaymentTrip).toHaveBeenCalledWith("b1");
  });

  it("says so and stays when the payment page could not be opened", async () => {
    vi.mocked(startBookingPayment).mockRejectedValue(new ApiError(502, "payment_provider_error", "Не удалось открыть страницу оплаты. Попробуйте ещё раз через минуту."));
    render(<BookingPayment token="t" booking={booking()} />);

    fireEvent.click(screen.getByRole("button", { name: "Оплатить эту тренировку" }));

    expect(await screen.findByText(/Не удалось открыть страницу оплаты/)).toBeTruthy();
    expect(openPaymentPage).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Оплатить эту тренировку" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("explains a started-but-unfinished payment and lets the person continue", () => {
    render(<BookingPayment token="t" booking={booking({ paymentStatus: "pending" })} />);

    expect(screen.getByText(/Оплата начата/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Оплатить эту тренировку" })).toBeTruthy();
  });
});

describe("«Мои брони»", () => {
  it("shows the pay button on an upcoming confirmed booking", async () => {
    vi.mocked(listMyBookings).mockResolvedValue([booking()]);
    render(<MyBookingsSection token="t" onBack={() => {}} />);
    await flush();

    expect(screen.getByRole("button", { name: "Оплатить эту тренировку" })).toBeTruthy();
  });

  it("opened from the «confirmed» notification, stays on the list so the button is in view (instead of jumping to the training)", async () => {
    vi.mocked(listMyBookings).mockResolvedValue([booking()]);
    render(<MyBookingsSection token="t" onBack={() => {}} focusBookingId="b1" />);
    await flush();

    expect(screen.queryByText(/TRAINING SCREEN/)).toBeNull();
    expect(screen.getByRole("button", { name: "Оплатить эту тренировку" })).toBeTruthy();
  });

  it("opened for a paid booking, goes to its training as before", async () => {
    vi.mocked(listMyBookings).mockResolvedValue([booking({ paymentStatus: "paid" })]);
    render(<MyBookingsSection token="t" onBack={() => {}} focusBookingId="b1" />);
    await flush();

    expect(screen.getByText("TRAINING SCREEN t-77")).toBeTruthy();
  });

  it("coming back from the payment page stays on the list and asks how the payment ended", async () => {
    vi.mocked(takePaymentTrip).mockReturnValue("b1");
    vi.mocked(listMyBookings).mockResolvedValue([booking({ paymentStatus: "pending" })]);
    vi.mocked(syncBookingPayment).mockResolvedValue(booking({ paymentStatus: "paid", paidAt: "2026-10-10T10:00:00Z" }));
    render(<MyBookingsSection token="t" onBack={() => {}} focusBookingId="b1" />);
    await flush();

    expect(syncBookingPayment).toHaveBeenCalledWith("t", "b1");
    expect(screen.queryByText(/TRAINING SCREEN/)).toBeNull();
    expect(screen.getByText(/Оплачено/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Оплатить эту тренировку" })).toBeNull();
  });
});

describe("the coach's «Записи»", () => {
  it("shows whether each confirmed session is paid", async () => {
    const { listCoachBookings } = await import("../../api/bookings");
    vi.mocked(listCoachBookings).mockResolvedValue([
      booking({ id: "p", paymentStatus: "paid" }),
      booking({ id: "u", paymentStatus: "unpaid", athleteFullName: "Олег" }),
      booking({ id: "f", paymentStatus: "not_required", athleteFullName: "Мария" }),
    ]);
    const { CoachBookingsSection } = await import("./CoachBookingsSection");
    render(<CoachBookingsSection token="t" onBack={() => {}} />);
    await flush();

    expect(screen.getByText("Подтверждена · оплачена")).toBeTruthy();
    expect(screen.getByText("Подтверждена · ждёт оплаты")).toBeTruthy();
    expect(screen.getByText("Подтверждена")).toBeTruthy();
  });
});

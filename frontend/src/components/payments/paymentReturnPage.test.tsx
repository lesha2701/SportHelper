import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncBookingPayment } from "../../api/payments";
import type { Booking, PaymentStatus } from "../../types/booking";
import { PaymentReturnPage } from "./PaymentReturnPage";

vi.mock("../../api/payments", () => ({ syncBookingPayment: vi.fn() }));
vi.mock("../public/PublicShell", () => ({ PublicShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
const navigateApp = vi.hoisted(() => vi.fn());
vi.mock("../../appNav", () => ({ navigateApp }));

const ID = "11111111-2222-4333-8444-555555555555";
const booking = (paymentStatus: PaymentStatus): Booking => ({ id: ID, pricePerSession: 2500, currency: "RUB", paymentStatus } as Booking);
const at = (query: string) => window.history.pushState(null, "", `/payments/return${query}`);
const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("coming back from the payment page", () => {
  it("shows «Оплата прошла» only when the server says paid", async () => {
    at(`?booking=${ID}`);
    vi.mocked(syncBookingPayment).mockResolvedValue(booking("paid"));
    render(<PaymentReturnPage token="t" />);
    await flush();

    expect(syncBookingPayment).toHaveBeenCalledWith("t", ID);
    expect(screen.getByRole("heading", { name: "Оплата прошла" })).toBeTruthy();
  });

  it("does not believe the address: an unpaid booking is never shown as paid, whatever the link says", async () => {
    at(`?booking=${ID}&status=succeeded&paid=true&result=ok`);
    vi.mocked(syncBookingPayment).mockResolvedValue(booking("unpaid"));
    render(<PaymentReturnPage token="t" />);
    await flush();

    expect(screen.queryByRole("heading", { name: "Оплата прошла" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Оплата не найдена" })).toBeTruthy();
  });

  it("keeps asking while the payment is being processed, a limited number of times, then shows it as paid", async () => {
    at(`?booking=${ID}`);
    vi.mocked(syncBookingPayment)
      .mockResolvedValueOnce(booking("processing"))
      .mockResolvedValueOnce(booking("processing"))
      .mockResolvedValue(booking("paid"));
    render(<PaymentReturnPage token="t" />);
    await flush();
    expect(screen.getByRole("heading", { name: "Оплата обрабатывается" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });

    expect(screen.getByRole("heading", { name: "Оплата прошла" })).toBeTruthy();
    expect(syncBookingPayment).toHaveBeenCalledTimes(3);
  });

  it("gives up asking after a bounded number of tries", async () => {
    at(`?booking=${ID}`);
    vi.mocked(syncBookingPayment).mockResolvedValue(booking("processing"));
    render(<PaymentReturnPage token="t" />);
    await flush();

    for (let i = 0; i < 20; i += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });
    }

    expect(vi.mocked(syncBookingPayment).mock.calls.length).toBeLessThanOrEqual(11);
  });

  it("says so when the cancelled payment did not take any money", async () => {
    at(`?booking=${ID}`);
    vi.mocked(syncBookingPayment).mockResolvedValue(booking("canceled"));
    render(<PaymentReturnPage token="t" />);
    await flush();

    expect(screen.getByRole("heading", { name: "Платёж отменён" })).toBeTruthy();
    expect(screen.getByText(/Деньги не списаны/)).toBeTruthy();
  });

  it("warns not to pay again when it cannot check, and offers the bookings list", async () => {
    at(`?booking=${ID}`);
    vi.mocked(syncBookingPayment).mockRejectedValue(new Error("offline"));
    render(<PaymentReturnPage token="t" />);
    await flush();

    expect(screen.getByText(/не оплачивайте повторно/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Открыть «Мои брони»" }));
    expect(navigateApp).toHaveBeenCalledWith({ kind: "my-bookings" });
  });

  it("asks nothing for a link without a valid booking number", async () => {
    at("?booking=../../etc/passwd");
    render(<PaymentReturnPage token="t" />);
    await flush();

    expect(syncBookingPayment).not.toHaveBeenCalled();
    expect(screen.getByText("Не удалось определить оплату")).toBeTruthy();
  });
});

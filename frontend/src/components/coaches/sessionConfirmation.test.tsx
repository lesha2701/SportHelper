import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confirmSession, getSessionCode, reportSessionProblem, verifySessionCode } from "../../api/bookings";
import { ApiError } from "../../api/client";
import { mapSessionConfirmationDto, type Booking, type SessionConfirmation as Confirmation } from "../../types/booking";
import { confirmationLine, SessionConfirmation } from "./SessionConfirmation";

vi.mock("../../api/bookings", () => ({
  confirmSession: vi.fn(),
  getSessionCode: vi.fn(),
  verifySessionCode: vi.fn(),
  reportSessionProblem: vi.fn(),
}));

const confirmation = (overrides: Partial<Confirmation> = {}): Confirmation => ({
  state: "awaiting", windowClosesAt: "2026-11-22T11:00:00Z", coachMarkedAt: null, confirmedAt: null, confirmedMethod: null,
  disputedByRole: null, disputeKind: null, disputeText: null, resolvedAt: null,
  canConfirm: false, canReportProblem: false, canGetCode: false, canEnterCode: false, ...overrides,
});

const booking = (sc: Confirmation | null, overrides: Partial<Booking> = {}): Booking => ({
  id: "b1", coachUserId: "c1", coachFullName: "Тренер Анна", listingId: "l1", listingTitle: "Теннис", athleteUserId: "a1",
  athleteFullName: "Игорь", athleteNotes: null, startsAt: "2026-11-20T10:00:00Z", durationMinutes: 60, format: "offline",
  pricePerSession: 2500, currency: "RUB", status: "confirmed", isCompleted: true, trainingId: "t1", trainingPlanId: null,
  trainingPlanName: null, trainingStatus: "scheduled", hasReview: false, hasPlayerReview: false, paymentStatus: "paid", paidAt: null,
  canCancel: false, hasStarted: true, cancellation: null, sessionConfirmation: sc, ...overrides,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("what each side reads", () => {
  it("tells the athlete to confirm and the coach that it waits for the athlete, with the moment it confirms itself", () => {
    const c = confirmation();
    expect(confirmationLine(c, "athlete")).toMatch(/Подтвердите её или сообщите о проблеме.*автоматически 22 нояб/);
    expect(confirmationLine(c, "coach")).toMatch(/^Ждём подтверждения игрока/);
    expect(confirmationLine(confirmation({ state: "scheduled" }), "athlete")).toBeNull();
  });

  it("says how it was confirmed and who reported a problem", () => {
    expect(confirmationLine(confirmation({ state: "confirmed", confirmedMethod: "athlete" }), "coach")).toBe("Игрок подтвердил тренировку.");
    expect(confirmationLine(confirmation({ state: "confirmed", confirmedMethod: "code" }), "athlete")).toBe("Тренировка подтверждена кодом игрока.");
    expect(confirmationLine(confirmation({ state: "auto_confirmed" }), "coach")).toBe("Тренировка подтверждена автоматически.");
    const disputed = confirmation({ state: "disputed", disputedByRole: "coach", disputeKind: "athlete_no_show" });
    expect(confirmationLine(disputed, "coach")).toBe("Вы сообщили: игрок не пришёл. Решение примет администратор.");
    expect(confirmationLine(disputed, "athlete")).toMatch(/^Тренер сообщил: игрок не пришёл.*напишите в поддержку/);
    expect(confirmationLine(confirmation({ state: "resolved_refunded" }), "athlete")).toBe("Спор решён: деньги возвращаются вам.");
    expect(confirmationLine(confirmation({ state: "resolved_released" }), "coach")).toBe("Спор решён: оплата за занятие ваша.");
  });

  it("shows a state it does not know yet as waiting, not as an error", () => {
    const mapped = mapSessionConfirmationDto({
      state: "something_new", window_closes_at: "2026-11-22T11:00:00Z", coach_marked_at: null, confirmed_at: null, confirmed_method: null,
      disputed_by_role: null, dispute_kind: null, dispute_text: null, resolved_at: null,
      can_confirm: false, can_report_problem: false, can_get_code: false, can_enter_code: false,
    });
    expect(mapped.state).toBe("awaiting");
  });
});

describe("the buttons follow the server's flags", () => {
  it("shows nothing before the session and for a booking without a confirmation", () => {
    const { container, rerender } = render(<SessionConfirmation token="t" booking={booking(null)} side="athlete" onChange={() => {}} />);
    expect(container.textContent).toBe("");
    rerender(<SessionConfirmation token="t" booking={booking(confirmation({ state: "scheduled" }))} side="athlete" onChange={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("lets the athlete confirm", async () => {
    const updated = booking(confirmation({ state: "confirmed", confirmedMethod: "athlete" }));
    vi.mocked(confirmSession).mockResolvedValue(updated);
    const onChange = vi.fn();
    render(<SessionConfirmation token="t" booking={booking(confirmation({ canConfirm: true, canReportProblem: true }))} side="athlete" onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "Ввести код игрока" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Подтвердить тренировку" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated));
    expect(confirmSession).toHaveBeenCalledWith("t", "b1");
  });

  it("shows the athlete's code once it is issued", async () => {
    vi.mocked(getSessionCode).mockResolvedValue({ code: "482913", expiresAt: "2026-11-20T10:45:00Z" });
    render(<SessionConfirmation token="t" booking={booking(confirmation({ state: "scheduled", canGetCode: true, canReportProblem: true }))} side="athlete" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Показать код тренеру" }));
    expect(await screen.findByText("482 913")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(screen.queryByText("482 913")).toBeNull();
  });

  it("lets the coach type the code and shows why it was refused", async () => {
    vi.mocked(verifySessionCode).mockRejectedValueOnce(new ApiError(422, "code_invalid", "Неверный код. Осталось попыток: 4."));
    const updated = booking(confirmation({ state: "confirmed", confirmedMethod: "code" }));
    vi.mocked(verifySessionCode).mockResolvedValueOnce(updated);
    const onChange = vi.fn();
    render(<SessionConfirmation token="t" booking={booking(confirmation({ canEnterCode: true }))} side="coach" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Ввести код игрока" }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "111 111" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    expect(await screen.findByText("Неверный код. Осталось попыток: 4.")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "482913" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated));
    expect(verifySessionCode).toHaveBeenLastCalledWith("t", "b1", "482913");
  });
});

describe("reporting a problem", () => {
  it("offers each side only its own kinds and needs words for «Другое»", async () => {
    const updated = booking(confirmation({ state: "disputed", disputedByRole: "athlete", disputeKind: "coach_no_show" }));
    vi.mocked(reportSessionProblem).mockResolvedValue(updated);
    const onChange = vi.fn();
    render(<SessionConfirmation token="t" booking={booking(confirmation({ canReportProblem: true }))} side="athlete" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Сообщить о проблеме" }));
    expect(screen.queryByLabelText("Игрок не пришёл")).toBeNull();

    fireEvent.click(screen.getByLabelText("Другое"));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(screen.getByText("Опишите, что случилось.")).toBeTruthy();
    expect(reportSessionProblem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Тренер не пришёл"));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated));
    expect(reportSessionProblem).toHaveBeenCalledWith("t", "b1", "coach_no_show", null);
  });

  it("shows the coach's report to the athlete with its words", () => {
    const sc = confirmation({ state: "disputed", disputedByRole: "coach", disputeKind: "athlete_no_show", disputeText: "Ждал 30 минут" });
    render(<SessionConfirmation token="t" booking={booking(sc)} side="athlete" onChange={() => {}} />);
    expect(screen.getByText(/Тренер сообщил: игрок не пришёл/)).toBeTruthy();
    expect(screen.getByText("«Ждал 30 минут»")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

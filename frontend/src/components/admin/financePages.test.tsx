import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/adminFinance";
import { getAdminSession } from "../../api/admin";
import AdminApp from "./AdminApp";
import { EarningsTab } from "./finance/EarningsTab";
import { WithdrawalsTab } from "./finance/WithdrawalsTab";

vi.mock("../../api/admin", () => ({ getAdminSession: vi.fn(), getAdminDashboard: vi.fn(() => new Promise(() => {})), listAdminComplaints: vi.fn(() => Promise.resolve({ total: 0, limit: 1, offset: 0, items: [] })) }));
vi.mock("../../api/adminFinance", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/adminFinance")>();
  return {
    camelize: real.camelize,
    listFinanceWithdrawals: vi.fn(),
    getFinanceWithdrawal: vi.fn(),
    getPayoutDetails: vi.fn(),
    reviewWithdrawal: vi.fn(),
    approveWithdrawal: vi.fn(),
    startWithdrawalProcessing: vi.fn(),
    rejectWithdrawal: vi.fn(),
    markWithdrawalPaid: vi.fn(),
    listFinanceEarnings: vi.fn(),
    releaseEarning: vi.fn(),
    holdEarning: vi.fn(),
    unholdEarning: vi.fn(),
  };
});
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ state: { status: "ready", user: { id: "me", email: "boss@example.com", isAdmin: true } } }) }));
vi.mock("../profile/AccountSecurity", () => ({ MfaSection: () => <div>MFA FORM</div> }));

const W = "11111111-2222-4333-8444-555555555555";
const withdrawal = (over: Partial<api.AdminWithdrawal> = {}): api.AdminWithdrawal => ({
  id: W, coachUserId: "c1", amountKopecks: 1_000_000, currency: "RUB", status: "requested", method: "sbp", detailsHint: "СБП · +7 ••• •••-••-12 · Сбербанк",
  decidedReason: null, bankReference: null, paidAmountKopecks: null, paidAt: null, transferNote: null, attention: null, createdAt: "2026-10-20T10:00:00Z",
  updatedAt: "2026-10-20T10:00:00Z", reviewedBy: null, approvedBy: null, processingBy: null, paidBy: null, coachFullName: "Анна Тренер", coachEmail: "anna@example.com", ...over,
});
const detail = (w: api.AdminWithdrawal): api.WithdrawalDetail => ({
  withdrawal: w, events: [], trainerBalances: { trainerPending: 0, trainerAvailable: 500_000, trainerReserved: 1_000_000, trainerDebt: 0 },
});
const page = <T,>(items: T[]) => ({ total: items.length, limit: 25, offset: 0, items });

async function openWithdrawal(w: api.AdminWithdrawal) {
  vi.mocked(api.listFinanceWithdrawals).mockResolvedValue(page([w]));
  vi.mocked(api.getFinanceWithdrawal).mockResolvedValue(detail(w));
  render(<WithdrawalsTab />);
  fireEvent.click(await screen.findByText("Анна Тренер"));
  return screen.findByRole("complementary", { name: "Заявка на вывод" });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/admin");
});
afterEach(cleanup);

describe("the «Финансы» section is only offered to finance administrators", () => {
  const session = (finance: boolean) => ({ isAdmin: true, mfaEnabled: true, mfaVerified: true, mfaRecent: true, finance });

  it("is absent from the menu of an ordinary administrator", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(session(false));
    render(<AdminApp />);
    await act(async () => {});
    expect(screen.queryByRole("link", { name: /Финансы/ })).toBeNull();
    expect(screen.getByRole("link", { name: /Пользователи/ })).toBeTruthy();
  });

  it("is in the menu of a finance administrator", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(session(true));
    render(<AdminApp />);
    await act(async () => {});
    expect(screen.getByRole("link", { name: /Финансы/ })).toBeTruthy();
  });
});

describe("handling a withdrawal request", () => {
  it("offers exactly the next step for each status", async () => {
    const drawer = await openWithdrawal(withdrawal({ status: "under_review" }));
    expect(within(drawer).getByRole("button", { name: "Одобрить" })).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: "Подтвердить выплату" })).toBeNull();
    expect(within(drawer).queryByRole("button", { name: "Взять на проверку" })).toBeNull();
  });

  it("moves a new request into review", async () => {
    const drawer = await openWithdrawal(withdrawal());
    vi.mocked(api.reviewWithdrawal).mockResolvedValue(withdrawal({ status: "under_review" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Взять на проверку" }));
    await waitFor(() => expect(api.reviewWithdrawal).toHaveBeenCalledWith(W));
  });

  it("keeps the requisites hidden until they are asked for explicitly", async () => {
    const drawer = await openWithdrawal(withdrawal());
    expect(within(drawer).queryByText("+79123456789")).toBeNull();
    vi.mocked(api.getPayoutDetails).mockResolvedValue({ method: "sbp", details: { phone: "+79123456789", bank: "Сбербанк", recipient: "Анна Т" } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Показать реквизиты" }));
    expect(await within(drawer).findByText("+79123456789")).toBeTruthy();
  });

  it("will not confirm a payout until the bank reference, the exact amount and the confirmation are given", async () => {
    const drawer = await openWithdrawal(withdrawal({ status: "processing" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Подтвердить выплату" }));
    const dialog = await screen.findByRole("dialog", { name: "Подтвердить выплату" });
    const confirm = within(dialog).getByRole("button", { name: "Подтвердить выплату" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(within(dialog).getByLabelText(/Банковский идентификатор/), { target: { value: "BANK-12345" } });
    fireEvent.change(within(dialog).getByLabelText(/Сумма перевода/), { target: { value: "9 999" } });
    fireEvent.click(within(dialog).getByLabelText(/Деньги действительно отправлены/));
    expect(confirm.disabled).toBe(true);
    expect(within(dialog).getByText("Сумма не совпадает с заявкой.")).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(/Сумма перевода/), { target: { value: "10 000" } });
    expect(confirm.disabled).toBe(false);

    vi.mocked(api.markWithdrawalPaid).mockResolvedValue(withdrawal({ status: "paid" }));
    fireEvent.click(confirm);
    await waitFor(() => expect(api.markWithdrawalPaid).toHaveBeenCalledWith(W, { bankReference: "BANK-12345", paidAmountKopecks: 1_000_000, paidAt: undefined, transferNote: undefined }));
  });

  it("rejecting a request already handed to payment requires saying the money was NOT sent", async () => {
    const drawer = await openWithdrawal(withdrawal({ status: "processing" }));
    fireEvent.click(within(drawer).getByRole("button", { name: "Отклонить" }));
    const dialog = await screen.findByRole("dialog", { name: "Отклонить заявку" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "реквизиты неверные" } });
    const confirm = within(dialog).getByRole("button", { name: "Отклонить" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(within(dialog).getByLabelText(/НЕ отправлены/));
    expect(confirm.disabled).toBe(false);
    vi.mocked(api.rejectWithdrawal).mockResolvedValue(withdrawal({ status: "rejected" }));
    fireEvent.click(confirm);
    await waitFor(() => expect(api.rejectWithdrawal).toHaveBeenCalledWith(W, "реквизиты неверные", true));
  });

  it("shows the server's refusal inside the dialog instead of closing it", async () => {
    const { ApiError } = await import("../../api/client");
    const drawer = await openWithdrawal(withdrawal({ status: "processing" }));
    vi.mocked(api.rejectWithdrawal).mockRejectedValue(new ApiError(409, "invalid_transition", "Эту заявку уже нельзя отклонить."));
    fireEvent.click(within(drawer).getByRole("button", { name: "Отклонить" }));
    const dialog = await screen.findByRole("dialog", { name: "Отклонить заявку" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "причина" } });
    fireEvent.click(within(dialog).getByLabelText(/НЕ отправлены/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Отклонить" }));
    expect(await within(dialog).findByText("Эту заявку уже нельзя отклонить.")).toBeTruthy();
  });
});

describe("releasing earnings", () => {
  const earning = (over: Partial<api.AdminEarning> = {}): api.AdminEarning => ({
    id: "e1", paymentId: "p1", bookingId: "b1", coachUserId: "c1", grossKopecks: 250_000, platformFeeKopecks: 25_000, trainerKopecks: 225_000, commissionPercent: "10",
    status: "pending", reversedKopecks: 0, heldReason: null, sessionConfirmedAt: null, releasedAt: null, releaseNote: null, createdAt: "2026-10-20T10:00:00Z",
    listingTitle: "Персональная тренировка", startsAt: "2026-10-21T10:00:00Z", trainingStatus: "scheduled", athleteFullName: "Игрок Один", coachFullName: "Анна Тренер", coachEmail: "anna@example.com", ...over,
  });

  it("cannot open money for a session the trainer has not marked as conducted", async () => {
    vi.mocked(api.listFinanceEarnings).mockResolvedValue(page([earning()]));
    render(<EarningsTab />);
    const button = (await screen.findByRole("button", { name: "Открыть тренеру" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("releases a confirmed session with a written note", async () => {
    vi.mocked(api.listFinanceEarnings).mockResolvedValue(page([earning({ sessionConfirmedAt: "2026-10-21T12:00:00Z" })]));
    render(<EarningsTab />);
    fireEvent.click(await screen.findByRole("button", { name: "Открыть тренеру" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "занятие подтверждено" } });
    vi.mocked(api.releaseEarning).mockResolvedValue(earning({ status: "available" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Открыть" }));
    await waitFor(() => expect(api.releaseEarning).toHaveBeenCalledWith("e1", "занятие подтверждено"));
  });
});

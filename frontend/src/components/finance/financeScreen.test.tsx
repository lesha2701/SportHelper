import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { cancelWithdrawal, getFinanceSummary, listFinanceOperations, listMyWithdrawals, requestWithdrawal } from "../../api/finance";
import type { FinanceOperation, FinanceSummary, Page, Withdrawal } from "../../types/finance";
import { FinanceScreen } from "./FinanceScreen";

vi.mock("../../api/finance", () => ({
  getFinanceSummary: vi.fn(),
  listFinanceOperations: vi.fn(),
  listMyWithdrawals: vi.fn(),
  requestWithdrawal: vi.fn(),
  cancelWithdrawal: vi.fn(),
}));

const summary = (over: Partial<FinanceSummary> = {}): FinanceSummary => ({
  availableKopecks: 1_500_000,
  pendingKopecks: 225_000,
  reservedKopecks: 0,
  paidOutKopecks: 300_000,
  debtKopecks: 0,
  minimumWithdrawalKopecks: 1_000_000,
  withdrawalsEnabled: true,
  canWithdraw: true,
  shortfallKopecks: 0,
  commissionPercent: "10",
  ...over,
});
const page = <T,>(items: T[], total = items.length, offset = 0): Page<T> => ({ total, limit: 10, offset, items });
const withdrawal = (over: Partial<Withdrawal> = {}): Withdrawal => ({
  id: "w1", amountKopecks: 1_000_000, status: "requested", method: "sbp", detailsHint: "СБП · +7 ••• •••-••-12 · Сбербанк", decidedReason: null, paidAt: null, createdAt: "2026-10-20T10:00:00Z", ...over,
});
const operation = (over: Partial<FinanceOperation> = {}): FinanceOperation => ({
  id: "o1", kind: "payment_received", createdAt: "2026-10-20T10:00:00Z", amountKopecks: 225_000, grossKopecks: 250_000, platformFeeKopecks: 25_000, trainerKopecks: 225_000,
  listingTitle: "Персональная тренировка", startsAt: null, earningStatus: "pending", withdrawalStatus: null, refundStatus: null, ...over,
});

function setup(opts: { summary?: FinanceSummary; withdrawals?: Withdrawal[]; operations?: FinanceOperation[] } = {}) {
  vi.mocked(getFinanceSummary).mockResolvedValue(opts.summary ?? summary());
  vi.mocked(listMyWithdrawals).mockResolvedValue(page(opts.withdrawals ?? []));
  vi.mocked(listFinanceOperations).mockResolvedValue(page(opts.operations ?? []));
  return render(<FinanceScreen token="t" onBack={() => {}} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000001" });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Intl uses a no-break space inside amounts, so compare after normalising it.
const text = () => (document.body.textContent ?? "").replace(/[  ]/g, " ");

describe("the trainer's balance", () => {
  it("shows every balance the server sends, in rubles", async () => {
    setup();
    await screen.findByRole("heading", { name: "Финансы" });
    expect(text()).toContain("15 000,00 ₽");
    expect(text()).toContain("2 250,00 ₽");
    expect(text()).toContain("3 000,00 ₽");
  });

  it("disables withdrawing below the minimum and says how much is missing", async () => {
    setup({ summary: summary({ availableKopecks: 400_000, canWithdraw: false, shortfallKopecks: 600_000 }) });
    const button = await screen.findByRole("button", { name: "Вывести средства" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain("Не хватает 6 000,00 ₽");
  });

  it("says withdrawing is unavailable when the server has it switched off", async () => {
    setup({ summary: summary({ withdrawalsEnabled: false, canWithdraw: false }) });
    const button = await screen.findByRole("button", { name: "Вывести средства" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(text()).toContain("Вывод средств пока недоступен");
  });

  it("tells the trainer about a debt", async () => {
    setup({ summary: summary({ debtKopecks: 50_000 }) });
    await screen.findByRole("heading", { name: "Финансы" });
    expect(text()).toContain("задолженность 500,00 ₽");
  });

  it("explains the money history with the price, the commission and the earning's state", async () => {
    setup({ operations: [operation()] });
    await screen.findByText("Оплата занятия получена");
    expect(text()).toContain("Игрок заплатил 2 500,00 ₽, комиссия платформы 250,00 ₽");
    expect(text()).toContain("ждёт проведения занятия");
  });

  it("asks the server for the next page instead of loading everything", async () => {
    vi.mocked(getFinanceSummary).mockResolvedValue(summary());
    vi.mocked(listMyWithdrawals).mockResolvedValue(page([]));
    vi.mocked(listFinanceOperations).mockResolvedValue(page([operation()], 25, 0));
    render(<FinanceScreen token="t" onBack={() => {}} />);
    await screen.findByText("Оплата занятия получена");

    fireEvent.click(screen.getByRole("button", { name: "Дальше →" }));
    await waitFor(() => expect(listFinanceOperations).toHaveBeenLastCalledWith("t", 10, 10));
  });
});

describe("withdrawal requests", () => {
  it("lets the trainer cancel a request that has not gone to payment, and only that one", async () => {
    setup({ withdrawals: [withdrawal({ id: "w1", status: "requested" }), withdrawal({ id: "w2", status: "processing" })] });
    await screen.findAllByText("Передана на выплату");
    expect(screen.getAllByRole("button", { name: "Отменить заявку" })).toHaveLength(1);

    vi.mocked(cancelWithdrawal).mockResolvedValue(withdrawal({ status: "canceled" }));
    fireEvent.click(screen.getByRole("button", { name: "Отменить заявку" }));
    await waitFor(() => expect(cancelWithdrawal).toHaveBeenCalledWith("t", "w1"));
  });

  it("shows the server's reason when cancelling is no longer possible", async () => {
    setup({ withdrawals: [withdrawal()] });
    vi.mocked(cancelWithdrawal).mockRejectedValue(new ApiError(409, "withdrawal_not_cancelable", "Эту заявку уже нельзя отменить: она передана на выплату."));
    fireEvent.click(await screen.findByRole("button", { name: "Отменить заявку" }));
    expect(await screen.findByText(/уже нельзя отменить/)).toBeTruthy();
  });

  function openForm() {
    return screen.findByRole("button", { name: "Вывести средства" }).then((b) => {
      fireEvent.click(b);
      return screen.findByRole("form", { name: "Заявка на вывод средств" });
    });
  }
  const fill = (form: HTMLElement, label: RegExp | string, value: string) => fireEvent.change(within(form).getByLabelText(label), { target: { value } });
  function fillSbp(form: HTMLElement, amount = "10 000") {
    fill(form, /Сумма/, amount);
    fill(form, "Номер телефона", "+7 912 345-67-89");
    fill(form, "Банк получателя", "Сбербанк");
    fill(form, /Получатель/, "Иван Петров");
    fill(form, /Пароль/, "secret-password");
  }

  it("sends exact kopecks, the chosen requisites, the password and one key for the whole form", async () => {
    setup();
    const form = await openForm();
    fillSbp(form, "10 000,50");
    vi.mocked(requestWithdrawal).mockResolvedValue(withdrawal());
    fireEvent.submit(form);

    await waitFor(() => expect(requestWithdrawal).toHaveBeenCalledTimes(1));
    expect(requestWithdrawal).toHaveBeenCalledWith("t", {
      amountKopecks: 1_000_050,
      method: "sbp",
      details: { phone: "+7 912 345-67-89", bank: "Сбербанк", recipient: "Иван Петров" },
      clientKey: "00000000-0000-4000-8000-000000000001",
      password: "secret-password",
    });
  });

  it("refuses an amount below the minimum or above the balance before asking the server", async () => {
    setup();
    const form = await openForm();
    fillSbp(form, "5 000");
    fireEvent.submit(form);
    expect(await within(form).findByText(/Минимальная сумма вывода/)).toBeTruthy();

    fill(form, /Сумма/, "20 000");
    fireEvent.submit(form);
    expect(await within(form).findByText("Нельзя вывести больше, чем доступно.")).toBeTruthy();
    fill(form, /Сумма/, "10,001");
    fireEvent.submit(form);
    expect(await within(form).findByText(/не больше двух знаков/)).toBeTruthy();
    expect(requestWithdrawal).not.toHaveBeenCalled();
  });

  it("has no field for a bank card", async () => {
    setup();
    const form = await openForm();
    expect(within(form).queryByLabelText(/карт/i)).toBeNull();
    expect(within(form).queryByLabelText(/CVV|CVC/i)).toBeNull();
    fireEvent.change(within(form).getByLabelText("Способ получения"), { target: { value: "bank_transfer" } });
    expect(within(form).queryByLabelText(/карт/i)).toBeNull();
    expect(within(form).getByLabelText(/Расчётный счёт/)).toBeTruthy();
  });

  it("shows the server's message under the field it belongs to (a wrong password)", async () => {
    setup();
    const form = await openForm();
    fillSbp(form);
    vi.mocked(requestWithdrawal).mockRejectedValue(new ApiError(403, "invalid_password", "Неверный пароль.", "password"));
    fireEvent.submit(form);
    expect(await within(form).findByText("Неверный пароль.")).toBeTruthy();
  });

  it("shows a message with no field of ours (e.g. too many requests) once, above the buttons", async () => {
    setup();
    const form = await openForm();
    fillSbp(form);
    vi.mocked(requestWithdrawal).mockRejectedValue(new ApiError(429, "rate_limited", "Слишком много заявок за час. Попробуйте позже."));
    fireEvent.submit(form);
    expect(await within(form).findAllByText("Слишком много заявок за час. Попробуйте позже.")).toHaveLength(1);
  });
});

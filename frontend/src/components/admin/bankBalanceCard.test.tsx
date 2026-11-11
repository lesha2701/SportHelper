import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/adminFinance";
import { BankBalanceCard } from "./finance/BankBalanceCard";

vi.mock("../../api/adminFinance", () => ({ getBankBalance: vi.fn(), enterBankBalance: vi.fn() }));

const entry = (over: Partial<api.BankBalanceEntry> = {}): api.BankBalanceEntry => ({
  id: 1, balanceKopecks: 1_000_000, trainersKopecks: 850_000, oursKopecks: 150_000, note: null, enteredByEmail: "boss@example.com", createdAt: "2026-11-11T10:00:00Z", ...over,
});
const balance = (latest: api.BankBalanceEntry | null, trainersNowKopecks: number): api.BankBalance => ({ latest, trainersNowKopecks, history: latest ? [latest] : [] });
const text = (re: RegExp) => screen.getAllByText(re).length > 0;

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("the settlement account card", () => {
  it("asks for the balance first and says what the trainers are owed meanwhile", async () => {
    vi.mocked(api.getBankBalance).mockResolvedValue(balance(null, 850_000));
    render(<BankBalanceCard />);
    expect(await screen.findByText(/Остаток расчётного счёта сайт не видит/)).toBeTruthy();
    expect(text(/Сейчас тренерам должны/)).toBe(true);
    expect(screen.getByRole("button", { name: "Ввести остаток" })).toBeTruthy();
  });

  it("splits the entered balance into the trainers' money and ours", async () => {
    vi.mocked(api.getBankBalance).mockResolvedValue(balance(entry({ note: "выписка" }), 850_000));
    render(<BankBalanceCard />);
    expect(await screen.findByText("Деньги тренеров")).toBeTruthy();
    expect(screen.getByText("Наши деньги")).toBeTruthy();
    expect(screen.getByText(/точно, по книгам/)).toBeTruthy();
    expect(screen.getByText(/«выписка»/)).toBeTruthy();
    expect(screen.getByText(/тренерские деньги не менялись/)).toBeTruthy();
  });

  it("says when the books moved since the entry, and shows a hole in the account", async () => {
    vi.mocked(api.getBankBalance).mockResolvedValue(balance(entry({ balanceKopecks: 800_000, oursKopecks: -50_000 }), 900_000));
    render(<BankBalanceCard />);
    expect(await screen.findByText(/на счёте меньше, чем должны тренерам/)).toBeTruthy();
    expect(screen.getByText(/стали должны на .*500,00.* больше/)).toBeTruthy();
  });

  it("sends the typed roubles as exact kopecks", async () => {
    vi.mocked(api.getBankBalance).mockResolvedValue(balance(null, 0));
    vi.mocked(api.enterBankBalance).mockResolvedValue(balance(entry(), 850_000));
    render(<BankBalanceCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Ввести остаток" }));
    fireEvent.change(screen.getByLabelText(/Остаток на счёте/), { target: { value: "125 000,50" } });
    fireEvent.change(screen.getByLabelText(/Пометка/), { target: { value: "из кабинета банка" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.enterBankBalance).toHaveBeenCalledWith(12_500_050, "из кабинета банка"));
  });

  it("accepts an empty account (0) and refuses text before asking the server", async () => {
    vi.mocked(api.getBankBalance).mockResolvedValue(balance(null, 0));
    vi.mocked(api.enterBankBalance).mockResolvedValue(balance(entry({ balanceKopecks: 0, trainersKopecks: 0, oursKopecks: 0 }), 0));
    render(<BankBalanceCard />);
    fireEvent.click(await screen.findByRole("button", { name: "Ввести остаток" }));
    const field = screen.getByLabelText(/Остаток на счёте/);

    fireEvent.change(field, { target: { value: "много" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText(/Введите сумму в рублях/)).toBeTruthy();
    expect(api.enterBankBalance).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(api.enterBankBalance).toHaveBeenCalledWith(0, ""));
  });
});

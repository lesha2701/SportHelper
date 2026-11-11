import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import * as api from "../../api/adminFinance";
import { CommissionCard } from "./finance/CommissionCard";

vi.mock("../../api/adminFinance", () => ({ getCommission: vi.fn(), setCommission: vi.fn() }));

const commission = (over: Partial<api.Commission> = {}): api.Commission => ({
  percent: "10", source: "environment", environmentPercent: "10", maxPercent: "50", history: [], ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Изменить комиссию" }));
  return screen.getByLabelText(/Новая комиссия/) as HTMLInputElement;
}

function fill(percent: string, reason = "Новый тариф") {
  fireEvent.change(screen.getByLabelText(/Новая комиссия/), { target: { value: percent } });
  fireEvent.change(screen.getByLabelText(/Причина/), { target: { value: reason } });
  const ack = screen.getByRole("checkbox") as HTMLInputElement;
  if (!ack.checked) fireEvent.click(ack);
}

describe("the commission card", () => {
  it("shows the percent in force, where it comes from and that it touches only new payments", async () => {
    vi.mocked(api.getCommission).mockResolvedValue(commission());
    render(<CommissionCard onChanged={() => {}} />);
    expect(await screen.findByText("10%")).toBeTruthy();
    expect(screen.getByText(/действует значение сервера \(10%\)/)).toBeTruthy();
    expect(screen.getByText(/уже созданные остаются с тем процентом/)).toBeTruthy();
  });

  it("lists the earlier changes with who made them and why", async () => {
    vi.mocked(api.getCommission).mockResolvedValue(
      commission({ percent: "12", source: "admin", history: [{ id: 1, percent: "12", previous: "10", reason: "Новый тариф", changedByEmail: "boss@example.com", createdAt: "2026-11-01T10:00:00Z" }] }),
    );
    render(<CommissionCard onChanged={() => {}} />);
    expect(await screen.findByText(/Установлена в этой панели/)).toBeTruthy();
    expect(screen.getByText(/История изменений \(1\)/)).toBeTruthy();
    expect(screen.getByText(/boss@example.com/)).toBeTruthy();
  });

  it("sends the new percent with the reason and reloads the overview", async () => {
    vi.mocked(api.getCommission).mockResolvedValue(commission());
    vi.mocked(api.setCommission).mockResolvedValue(commission({ percent: "7.5", source: "admin" }));
    const onChanged = vi.fn();
    render(<CommissionCard onChanged={onChanged} />);
    expect((await openDialog()).value).toBe("10");

    fill("7,5");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.setCommission).toHaveBeenCalledWith("7.5", "Новый тариф");
  });

  it("refuses a nonsense, too big or unchanged percent before asking the server", async () => {
    vi.mocked(api.getCommission).mockResolvedValue(commission());
    render(<CommissionCard onChanged={() => {}} />);
    await openDialog();

    for (const [typed, message] of [["abc", /числом/], ["51", /больше 50%/], ["10", /и так текущая/]] as const) {
      fill(typed);
      fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
      expect(await screen.findByText(message)).toBeTruthy();
    }
    expect(api.setCommission).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and keeps the dialog open", async () => {
    vi.mocked(api.getCommission).mockResolvedValue(commission());
    vi.mocked(api.setCommission).mockRejectedValue(new ApiError(409, "commission_unchanged", "Это и так текущая комиссия."));
    const onChanged = vi.fn();
    render(<CommissionCard onChanged={onChanged} />);
    await openDialog();
    fill("12");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    expect(await screen.findByText("Это и так текущая комиссия.")).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});

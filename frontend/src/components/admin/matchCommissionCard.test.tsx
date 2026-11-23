import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import * as api from "../../api/adminFinance";
import { MatchCommissionCard } from "./finance/MatchCommissionCard";

vi.mock("../../api/adminFinance", () => ({ getMatchCommission: vi.fn(), setMatchCommission: vi.fn() }));

const view = (over: Partial<api.MatchCommission> = {}): api.MatchCommission => ({
  percent: "50", source: "environment", environmentPercent: "50", maxPercent: "100", attributionDays: 30, history: [], ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Изменить процент подбора" }));
  return screen.getByLabelText(/Новый процент/) as HTMLInputElement;
}

function fill(percent: string, reason = "Новый тариф") {
  fireEvent.change(screen.getByLabelText(/Новый процент/), { target: { value: percent } });
  fireEvent.change(screen.getByLabelText(/Причина/), { target: { value: reason } });
  const ack = screen.getByRole("checkbox") as HTMLInputElement;
  if (!ack.checked) fireEvent.click(ack);
}

describe("the first-session percent card", () => {
  it("shows the percent, where it comes from and how long the matching rules last", async () => {
    vi.mocked(api.getMatchCommission).mockResolvedValue(view());
    render(<MatchCommissionCard />);
    expect(await screen.findByText("50%")).toBeTruthy();
    expect(screen.getByText(/действует значение сервера \(50%\)/)).toBeTruthy();
    expect(screen.getByText(/в течение 30 дн\./)).toBeTruthy();
  });

  it("lists earlier changes with who made them and why", async () => {
    vi.mocked(api.getMatchCommission).mockResolvedValue(
      view({ percent: "40", source: "admin", history: [{ id: 1, percent: "40", previous: "50", reason: "Акция", changedByEmail: "boss@example.com", createdAt: "2026-11-01T10:00:00Z" }] }),
    );
    render(<MatchCommissionCard />);
    expect(await screen.findByText(/История изменений \(1\)/)).toBeTruthy();
    expect(screen.getByText(/boss@example.com/)).toBeTruthy();
  });

  it("sends the new percent (up to 100) with the reason", async () => {
    vi.mocked(api.getMatchCommission).mockResolvedValue(view());
    vi.mocked(api.setMatchCommission).mockResolvedValue(view({ percent: "37.5", source: "admin" }));
    render(<MatchCommissionCard />);
    expect((await openDialog()).value).toBe("50");

    fill("37,5");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    await waitFor(() => expect(api.setMatchCommission).toHaveBeenCalledWith("37.5", "Новый тариф"));
  });

  it("refuses nonsense, too big or unchanged percent before asking the server", async () => {
    vi.mocked(api.getMatchCommission).mockResolvedValue(view());
    render(<MatchCommissionCard />);
    await openDialog();

    fill("abc");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    expect(screen.getByText(/Введите процент числом/)).toBeTruthy();
    fill("101");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    expect(screen.getByText(/не может быть больше 100%/)).toBeTruthy();
    fill("50");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    expect(screen.getByText(/Это и так текущий процент/)).toBeTruthy();
    expect(api.setMatchCommission).not.toHaveBeenCalled();
  });

  it("shows what the server refused", async () => {
    vi.mocked(api.getMatchCommission).mockResolvedValue(view());
    vi.mocked(api.setMatchCommission).mockRejectedValue(new ApiError(409, "commission_unchanged", "Это и так текущий процент."));
    render(<MatchCommissionCard />);
    await openDialog();
    fill("60");
    fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
    expect(await screen.findByText("Это и так текущий процент.")).toBeTruthy();
  });
});

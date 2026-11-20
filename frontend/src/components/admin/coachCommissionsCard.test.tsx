import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import * as api from "../../api/adminFinance";
import { CoachCommissionsCard } from "./finance/CoachCommissionsCard";

vi.mock("../../api/adminFinance", () => ({ listCoachCommissions: vi.fn(), setCoachCommission: vi.fn() }));

const coach = (over: Partial<api.CoachCommission> = {}): api.CoachCommission => ({
  coachUserId: "c1", fullName: "Алиса Тренерова", email: "alice@example.com", personalPercent: null, percent: "10", since: null, reason: null, setByEmail: null, ...over,
});
const page = (items: api.CoachCommission[]): api.CoachCommissionsPage => ({ total: items.length, limit: 10, offset: 0, items, generalPercent: "10", maxPercent: "50" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listCoachCommissions).mockResolvedValue(page([coach()]));
});
afterEach(cleanup);

function fill(percent: string | null, reason = "Договорённость") {
  if (percent !== null) fireEvent.change(screen.getByLabelText(/Личная комиссия, %/), { target: { value: percent } });
  fireEvent.change(screen.getByLabelText(/Причина/), { target: { value: reason } });
  const ack = screen.getByRole("checkbox") as HTMLInputElement;
  if (!ack.checked) fireEvent.click(ack);
}

describe("personal commissions of trainers", () => {
  it("shows what each trainer pays and whether it is a personal percent", async () => {
    vi.mocked(api.listCoachCommissions).mockResolvedValue(
      page([coach({ personalPercent: "5", percent: "5", since: "2026-11-01T10:00:00Z", reason: "Партнёрская программа", setByEmail: "boss@example.com" }), coach({ coachUserId: "c2", fullName: "Борис", email: "b@example.com" })]),
    );
    render(<CoachCommissionsCard />);
    expect(await screen.findByText("Личная")).toBeTruthy();
    expect(screen.getByText("Общая")).toBeTruthy();
    expect(screen.getByText(/Партнёрская программа/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Вернуть общую комиссию: Алиса/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Задать комиссию/ })).toHaveLength(1); // only for the trainer who has none
  });

  it("searches by name and can show only the trainers with a personal percent", async () => {
    render(<CoachCommissionsCard />);
    await screen.findByText("Алиса Тренерова");
    fireEvent.change(screen.getByLabelText("Поиск тренера"), { target: { value: "алиса" } });
    await waitFor(() => expect(api.listCoachCommissions).toHaveBeenLastCalledWith(expect.objectContaining({ q: "алиса", onlyPersonal: false })));
    fireEvent.click(screen.getByRole("button", { name: "Только с личным процентом" }));
    await waitFor(() => expect(api.listCoachCommissions).toHaveBeenLastCalledWith(expect.objectContaining({ onlyPersonal: true })));
  });

  it("sets a personal percent with the reason and reloads the list", async () => {
    vi.mocked(api.setCoachCommission).mockResolvedValue(coach({ personalPercent: "7.5", percent: "7.5" }));
    render(<CoachCommissionsCard />);
    fireEvent.click(await screen.findByRole("button", { name: /Задать комиссию: Алиса/ }));
    fill("7,5");
    fireEvent.click(screen.getByRole("button", { name: "Поставить" }));
    await waitFor(() => expect(api.setCoachCommission).toHaveBeenCalledWith("c1", "7.5", "Договорённость"));
    await waitFor(() => expect(vi.mocked(api.listCoachCommissions).mock.calls.length).toBeGreaterThan(1));
  });

  it("refuses a nonsense, too big or unchanged percent before asking the server", async () => {
    vi.mocked(api.listCoachCommissions).mockResolvedValue(page([coach({ personalPercent: "5", percent: "5" })]));
    render(<CoachCommissionsCard />);
    fireEvent.click(await screen.findByRole("button", { name: /Изменить комиссию: Алиса/ }));
    for (const [typed, message] of [["abc", /числом/], ["51", /больше 50%/], ["5", /и так стоит такая/]] as const) {
      fill(typed);
      fireEvent.click(screen.getByRole("button", { name: "Поставить" }));
      expect(await screen.findByText(message)).toBeTruthy();
    }
    expect(api.setCoachCommission).not.toHaveBeenCalled();
  });

  it("hands the trainer back to the general commission by sending a null percent", async () => {
    vi.mocked(api.listCoachCommissions).mockResolvedValue(page([coach({ personalPercent: "5", percent: "5" })]));
    vi.mocked(api.setCoachCommission).mockResolvedValue(coach());
    render(<CoachCommissionsCard />);
    fireEvent.click(await screen.findByRole("button", { name: /Вернуть общую комиссию: Алиса/ }));
    expect(screen.getByText(/снова будет платить общую комиссию \(10%\)/)).toBeTruthy();
    fill(null, "Акция закончилась");
    fireEvent.click(screen.getByRole("button", { name: "Вернуть общую" }));
    await waitFor(() => expect(api.setCoachCommission).toHaveBeenCalledWith("c1", null, "Акция закончилась"));
  });

  it("shows the server's refusal and keeps the dialog open", async () => {
    vi.mocked(api.setCoachCommission).mockRejectedValue(new ApiError(409, "coach_commission_unchanged", "У этого тренера и так стоит такая личная комиссия."));
    render(<CoachCommissionsCard />);
    fireEvent.click(await screen.findByRole("button", { name: /Задать комиссию: Алиса/ }));
    fill("12");
    fireEvent.click(screen.getByRole("button", { name: "Поставить" }));
    expect(await screen.findByText("У этого тренера и так стоит такая личная комиссия.")).toBeTruthy();
    expect(screen.getByLabelText(/Личная комиссия, %/)).toBeTruthy();
  });
});

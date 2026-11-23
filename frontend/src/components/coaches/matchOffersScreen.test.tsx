import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptCoachOffer,
  declineCoachOffer,
  getMatchOfferSettings,
  listCoachOffers,
  saveMatchOfferSettings,
  type CoachOffer,
  type MatchOfferSettings,
} from "../../api/matchOffers";
import { ApiError } from "../../api/client";
import { MatchOffersScreen } from "./MatchOffersScreen";

vi.mock("../../api/matchOffers");
const flush = () => act(async () => {});

const off: MatchOfferSettings = {
  enabled: false, acceptedVersion: null, currentVersion: "2026-11-23", termsAccepted: false, firstSessionPercent: 50, termsTitle: "Условия подбора клиентов",
  terms: ["Мы подбираем тренеров спортсменам.", "За первую тренировку платформа удерживает 50%."],
};
const waiting: CoachOffer = {
  id: "o1", status: "proposed", createdAt: "2026-11-23T10:00:00Z", expiresAt: "2026-11-25T10:00:00Z", firstSessionPercent: 50, adminMessage: "Подходит по уровню",
  request: {
    sport: "Теннис", goal: "Поставить удар справа", level: "amateur", format: "offline", city: "Москва", budgetMin: 1500, budgetMax: 3000, currency: "RUB",
    weekdays: [1], dayParts: ["evening"], scheduleNote: null, comment: "[контакт скрыт]",
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getMatchOfferSettings).mockResolvedValue(off);
  vi.mocked(listCoachOffers).mockResolvedValue([]);
});
afterEach(cleanup);

const open = async () => {
  render(<MatchOffersScreen onBack={vi.fn()} />);
  await flush();
};

describe("«Подбор клиентов» of a trainer", () => {
  it("shows the terms before the trainer agrees, and switches the matching on with the version read", async () => {
    vi.mocked(saveMatchOfferSettings).mockResolvedValue({ ...off, enabled: true, termsAccepted: true, acceptedVersion: "2026-11-23" });
    await open();

    expect(screen.getByText("Условия подбора клиентов")).toBeTruthy();
    expect(screen.getByText(/платформа удерживает 50%/)).toBeTruthy();
    expect(screen.getByText(/Предложений пока нет/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch"));
    await flush();

    expect(saveMatchOfferSettings).toHaveBeenCalledWith(true, "2026-11-23");
    expect(screen.getByText("Меня можно рекомендовать")).toBeTruthy();
  });

  it("switches it off without sending a version", async () => {
    vi.mocked(getMatchOfferSettings).mockResolvedValue({ ...off, enabled: true, termsAccepted: true, acceptedVersion: "2026-11-23" });
    vi.mocked(saveMatchOfferSettings).mockResolvedValue(off);
    await open();

    fireEvent.click(screen.getByRole("switch"));
    await flush();

    expect(saveMatchOfferSettings).toHaveBeenCalledWith(false, null);
  });

  it("says when the terms were updated", async () => {
    vi.mocked(getMatchOfferSettings).mockResolvedValue({ ...off, acceptedVersion: "2020-01-01" });
    await open();

    expect(screen.getByText(/Условия обновились/)).toBeTruthy();
  });

  it("shows an offer without the athlete's name, with the percent, and accepts it", async () => {
    vi.mocked(listCoachOffers).mockResolvedValue([waiting]);
    vi.mocked(acceptCoachOffer).mockResolvedValue({ ...waiting, status: "coach_accepted" });
    await open();

    expect(screen.getByText("Поставить удар справа")).toBeTruthy();
    expect(screen.getByText("[контакт скрыт]")).toBeTruthy();
    expect(screen.getByText("Подходит по уровню")).toBeTruthy();
    expect(screen.getByText(/удерживает 50% вместо обычной комиссии/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Принять клиента" }));
    await flush();

    expect(acceptCoachOffer).toHaveBeenCalledWith("o1");
    expect(screen.getByText("Вы согласились")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Принять клиента" })).toBeNull();
  });

  it("declines with an optional reason", async () => {
    vi.mocked(listCoachOffers).mockResolvedValue([waiting]);
    vi.mocked(declineCoachOffer).mockResolvedValue({ ...waiting, status: "coach_declined" });
    await open();

    fireEvent.click(screen.getByRole("button", { name: "Отказаться" }));
    fireEvent.change(screen.getByPlaceholderText("Причина (необязательно)"), { target: { value: "  Нет времени " } });
    fireEvent.click(screen.getByRole("button", { name: "Отказаться" }));
    await flush();

    expect(declineCoachOffer).toHaveBeenCalledWith("o1", "Нет времени");
    expect(screen.getByText("Вы отказались")).toBeTruthy();
  });

  it("shows the server's refusal and reloads", async () => {
    vi.mocked(listCoachOffers).mockResolvedValue([waiting]);
    vi.mocked(acceptCoachOffer).mockRejectedValue(new ApiError(409, "offer_closed", "Время ответа вышло."));
    await open();

    fireEvent.click(screen.getByRole("button", { name: "Принять клиента" }));
    await flush();

    expect(screen.getByText("Время ответа вышло.")).toBeTruthy();
    expect(listCoachOffers).toHaveBeenCalledTimes(2);
  });

  it("does not offer actions on an answered offer", async () => {
    vi.mocked(listCoachOffers).mockResolvedValue([{ ...waiting, status: "withdrawn" }]);
    await open();

    expect(screen.getByText("Закрыто")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Принять клиента" })).toBeNull();
  });
});

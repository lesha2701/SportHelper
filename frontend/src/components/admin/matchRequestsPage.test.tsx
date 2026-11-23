import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "../../api/admin";
import { MatchRequestsPage } from "./MatchRequestsPage";

vi.mock("../../api/admin");
vi.mock("../../toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = vi.mocked(adminApi);

const ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const flush = () => act(async () => {});

function request(over: Partial<adminApi.AdminMatchRequest> = {}): adminApi.AdminMatchRequest {
  return {
    id: ID, sport: "Теннис", goal: "Поставить удар справа", level: "amateur", format: "offline", city: "Москва", budgetMin: 1500, budgetMax: 3000,
    currency: "RUB", weekdays: [1, 5], dayParts: ["evening"], scheduleNote: "после 19:00", comment: "Занимался в детстве", status: "new",
    createdAt: "2026-11-23T10:00:00Z", author: { id: "u1", name: "Анна Игрок", email: "anna@example.com" }, adminNote: null, handledBy: null,
    handledAt: null, offers: [], ...over,
  };
}
const page = (items: adminApi.AdminMatchRequest[]) => ({ total: items.length, limit: 25, offset: 0, items });

beforeEach(() => {
  Object.values(api).forEach((fn) => typeof fn === "function" && "mockReset" in fn && (fn as ReturnType<typeof vi.fn>).mockReset());
  api.listMatchCandidates.mockResolvedValue([]);
  window.history.replaceState(null, "", "/admin/matching");
});
afterEach(cleanup);

const openQueue = async () => {
  render(<MatchRequestsPage />);
  await flush();
};

describe("the matching queue", () => {
  it("lists the requests with the author, the budget and the status", async () => {
    api.listAdminMatchRequests.mockResolvedValue(page([request()]));
    await openQueue();

    const table = screen.getByRole("table");
    expect(within(table).getByText("Теннис")).toBeTruthy();
    expect(within(table).getByText("anna@example.com")).toBeTruthy();
    expect(within(table).getByText("от 1 500 до 3 000 ₽")).toBeTruthy();
    expect(within(table).getByText("Новая")).toBeTruthy();
  });

  it("filters by status and says so when there is nothing", async () => {
    api.listAdminMatchRequests.mockResolvedValue(page([]));
    await openQueue();
    fireEvent.click(screen.getByRole("button", { name: "В работе" }));
    await flush();

    expect(api.listAdminMatchRequests.mock.calls.at(-1)![0]).toMatchObject({ status: "in_progress" });
    expect(screen.getByText("Заявок нет.")).toBeTruthy();
  });

  it("opens a request with everything the person filled in", async () => {
    api.listAdminMatchRequests.mockResolvedValue(page([request()]));
    await openQueue();
    fireEvent.click(screen.getByText("Теннис"));
    await flush();

    const drawer = screen.getByRole("complementary", { name: "Заявка на подбор тренера" });
    for (const text of ["Поставить удар справа", "Любитель", "Очно", "Москва", "Вт, Сб · вечер", "после 19:00", "Занимался в детстве", "anna@example.com"]) {
      expect(within(drawer).getByText(text)).toBeTruthy();
    }
  });

  it("takes a request and closes it with a note", async () => {
    api.listAdminMatchRequests.mockResolvedValue(page([request()]));
    api.takeAdminMatchRequest.mockResolvedValue(request({ status: "in_progress" }));
    api.closeAdminMatchRequest.mockResolvedValue(request({ status: "closed" }));
    await openQueue();
    fireEvent.click(screen.getByText("Теннис"));
    await flush();
    const drawer = screen.getByRole("complementary", { name: "Заявка на подбор тренера" });

    fireEvent.click(within(drawer).getByRole("button", { name: "Взять в работу" }));
    await flush();
    expect(api.takeAdminMatchRequest).toHaveBeenCalledWith(ID);

    fireEvent.click(within(drawer).getByRole("button", { name: "Закрыть заявку" }));
    await flush();
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Предложили тренеру Иванову" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    await flush();
    expect(api.closeAdminMatchRequest).toHaveBeenCalledWith(ID, "Предложили тренеру Иванову");
  });

  it("offers no actions on a request that is over", async () => {
    api.listAdminMatchRequests.mockResolvedValue(page([request({ status: "closed", adminNote: "Нет тренеров", handledBy: "boss@example.com" })]));
    await openQueue();
    fireEvent.click(screen.getByText("Теннис"));
    await flush();
    const drawer = screen.getByRole("complementary", { name: "Заявка на подбор тренера" });

    expect(within(drawer).queryByRole("button", { name: "Закрыть заявку" })).toBeNull();
    expect(within(drawer).getByText("Нет тренеров")).toBeTruthy();
  });
});

const offerOf = (over: Partial<adminApi.AdminMatchOffer> = {}): adminApi.AdminMatchOffer => ({
  id: "o1", status: "proposed", coach: { id: "c1", name: "Иван Тренеров", email: "ivan@example.com" }, coachSport: "Теннис", firstSessionPercent: 50,
  adminMessage: "Подходит по уровню", coachDeclineReason: null, createdAt: "2026-11-23T11:00:00Z", expiresAt: "2026-11-25T11:00:00Z",
  athleteExpiresAt: null, coachRespondedAt: null, athleteRespondedAt: null, ...over,
});
const candidate = (over: Partial<adminApi.MatchCandidate> = {}): adminApi.MatchCandidate => ({
  coachUserId: "c2", name: "Пётр Теннисов", isPro: true, sport: "Теннис", specialization: null, experienceYears: 7, averageRating: 4.8, reviewCount: 12,
  sameSport: true, alreadyOffered: false, ...over,
});
const openDrawer = async () => {
  fireEvent.click(screen.getByText("Теннис"));
  await flush();
  return screen.getByRole("complementary", { name: "Заявка на подбор тренера" });
};

describe("offers to trainers", () => {
  it("lists the offers with the trainer's answer, the percent fixed in them and the decline reason", async () => {
    api.listAdminMatchRequests.mockResolvedValue(
      page([request({ status: "in_progress", offers: [offerOf(), offerOf({ id: "o2", status: "coach_declined", coach: { id: "c3", name: "Олег", email: null }, coachDeclineReason: "Нет времени" })] })]),
    );
    await openQueue();
    const drawer = await openDrawer();

    expect(within(drawer).getByText("Иван Тренеров")).toBeTruthy();
    expect(within(drawer).getByText("Ждёт ответа тренера")).toBeTruthy();
    expect(within(drawer).getAllByText(/Первая тренировка: 50%/)).toHaveLength(2);
    expect(within(drawer).getByText("Тренер отказался")).toBeTruthy();
    expect(within(drawer).getByText(/Нет времени/)).toBeTruthy();
    expect(within(drawer).getAllByRole("button", { name: "Отозвать" })).toHaveLength(1); // only the one still waiting
  });

  it("withdraws a waiting offer", async () => {
    api.listAdminMatchRequests.mockResolvedValue(page([request({ status: "in_progress", offers: [offerOf()] })]));
    api.withdrawMatchOffer.mockResolvedValue(request({ status: "in_progress", offers: [offerOf({ status: "withdrawn" })] }));
    await openQueue();
    const drawer = await openDrawer();

    fireEvent.click(within(drawer).getByRole("button", { name: "Отозвать" }));
    await flush();

    expect(api.withdrawMatchOffer).toHaveBeenCalledWith("o1");
  });

  it("searches the trainers who can be offered and offers one with a message", async () => {
    api.listAdminMatchRequests.mockResolvedValue(page([request()]));
    api.listMatchCandidates.mockResolvedValue([candidate(), candidate({ coachUserId: "c4", name: "Уже спрошенный", alreadyOffered: true })]);
    api.createMatchOffer.mockResolvedValue(request({ status: "in_progress", offers: [offerOf()] }));
    await openQueue();
    const drawer = await openDrawer();

    expect(within(drawer).getByText("Пётр Теннисов")).toBeTruthy();
    expect((within(drawer).getByRole("button", { name: "Уже предлагали" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(drawer).getByLabelText("Сообщение тренеру"), { target: { value: " Подходит по уровню " } });
    fireEvent.click(within(drawer).getByRole("button", { name: "Предложить" }));
    await flush();

    expect(api.createMatchOffer).toHaveBeenCalledWith(ID, "c2", "Подходит по уровню");
  });

  it("does not offer trainers on a request that is over, but keeps the history", async () => {
    api.listAdminMatchRequests.mockResolvedValue(page([request({ status: "closed", offers: [offerOf({ status: "withdrawn" })] })]));
    await openQueue();
    const drawer = await openDrawer();

    expect(within(drawer).queryByLabelText("Поиск тренера")).toBeNull();
    expect(within(drawer).getByText("Отозвано")).toBeTruthy();
    expect(api.listMatchCandidates).not.toHaveBeenCalled();
  });

  it("lets a matched request be closed", async () => {
    api.listAdminMatchRequests.mockResolvedValue(page([request({ status: "matched", offers: [offerOf({ status: "athlete_accepted" })] })]));
    await openQueue();
    const drawer = await openDrawer();

    expect(within(drawer).getByRole("button", { name: "Закрыть заявку" })).toBeTruthy();
    expect(within(drawer).queryByLabelText("Поиск тренера")).toBeNull();
  });
});

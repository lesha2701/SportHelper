import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "../../api/admin";
import { ApiError } from "../../api/client";
import { ComplaintsPage } from "./ComplaintsPage";
import { ModerationPage } from "./ModerationPage";
import { StepUpProvider } from "./stepUp";
import { TrainingsPage } from "./TrainingsPage";

vi.mock("../../api/admin");
vi.mock("../../api/auth", () => ({ verifyMfa: vi.fn(() => Promise.resolve()) }));
vi.mock("../../toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = vi.mocked(adminApi);

const FILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LISTING = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COMPLAINT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const flush = () => act(async () => {});

function media(overrides: Partial<adminApi.AdminMedia> = {}): adminApi.AdminMedia {
  return {
    id: FILE, kind: "gallery", mediaType: "image", filename: "photo.webp", mimeType: "image/webp", sizeBytes: 250_000,
    createdAt: "2026-10-10T10:00:00Z", owner: { id: USER, email: "owner@example.com", name: "Олег Автор" }, hidden: false, hiddenAt: null,
    moderationReason: null, hiddenBy: null, hasThumb: true, ...overrides,
  };
}

const page = <T,>(items: T[]) => ({ total: items.length, limit: 24, offset: 0, items });

beforeEach(() => {
  Object.values(api).forEach((fn) => typeof fn === "function" && "mockReset" in fn && (fn as ReturnType<typeof vi.fn>).mockReset());
  window.history.replaceState(null, "", "/admin/moderation");
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
  api.fetchAdminMediaBlob.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
});
afterEach(cleanup);

describe("media moderation", () => {
  const open = async () => {
    render(
      <StepUpProvider>
        <ModerationPage />
      </StepUpProvider>,
    );
    await flush();
  };
  const detail = (over: Partial<adminApi.AdminMediaDetail> = {}): adminApi.AdminMediaDetail => ({
    ...media(), related: { type: "listing", id: LISTING, label: "Объявление «Теннис»" }, openComplaints: 2, ...over,
  });

  it("shows a grid of what people uploaded, with the author and a hidden mark", async () => {
    api.listAdminMedia.mockResolvedValue(page([media(), media({ id: "x2", hidden: true, kind: "avatar", filename: "me.webp" })]));

    await open();

    expect(screen.getByRole("button", { name: "Открыть: photo.webp" })).toBeTruthy();
    expect(screen.getAllByText("Олег Автор").length).toBe(2);
    expect(screen.getByText("Скрыто")).toBeTruthy();
    expect(api.fetchAdminMediaBlob).toHaveBeenCalledWith(FILE, "thumb");
  });

  it("sends the filters and the author search to the server", async () => {
    api.listAdminMedia.mockResolvedValue(page([]));
    await open();

    fireEvent.change(screen.getByLabelText("Тип материала"), { target: { value: "avatar" } });
    await flush();
    fireEvent.change(screen.getByLabelText("Состояние"), { target: { value: "hidden" } });
    await flush();

    const last = api.listAdminMedia.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ kind: "avatar", state: "hidden", limit: 24, offset: 0 });
    expect(screen.getByText(/Ничего не найдено/)).toBeTruthy();
  });

  it("opens a card with the file, its author, the related listing and open complaints", async () => {
    api.listAdminMedia.mockResolvedValue(page([media()]));
    api.getAdminMedia.mockResolvedValue(detail());
    await open();

    fireEvent.click(screen.getByRole("button", { name: "Открыть: photo.webp" }));
    await flush();

    const drawer = screen.getByRole("complementary", { name: "Карточка материала" });
    expect(within(drawer).getByRole("link", { name: "Олег Автор" }).getAttribute("href")).toBe(`/admin/users?open=${USER}`);
    expect(within(drawer).getByRole("link", { name: "Объявление «Теннис»" }).getAttribute("href")).toBe(`/admin/trainings?tab=listings&open=${LISTING}`);
    expect(within(drawer).getByRole("link", { name: "Открытых: 2" }).getAttribute("href")).toBe(`/admin/reports?q=${FILE}`);
    expect(within(drawer).getByRole("img", { name: "photo.webp" })).toBeTruthy();
  });

  it("hides a file only with a written reason", async () => {
    api.listAdminMedia.mockResolvedValue(page([media()]));
    api.getAdminMedia.mockResolvedValue(detail());
    api.hideAdminMedia.mockResolvedValue(detail({ hidden: true }));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Открыть: photo.webp" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Скрыть с сайта" }));
    const dialog = screen.getByRole("dialog", { name: "Скрыть с сайта" });
    const confirm = within(dialog).getByRole("button", { name: "Скрыть" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Реклама казино" } });
    fireEvent.click(confirm);
    await flush();

    expect(api.hideAdminMedia).toHaveBeenCalledWith(FILE, "Реклама казино");
    expect(api.deleteAdminMedia).not.toHaveBeenCalled();
  });

  it("offers to restore a hidden file instead", async () => {
    api.listAdminMedia.mockResolvedValue(page([media({ hidden: true })]));
    api.getAdminMedia.mockResolvedValue(detail({ hidden: true, moderationReason: "Реклама", hiddenBy: "boss@example.com", hiddenAt: "2026-10-11T10:00:00Z" }));
    api.restoreAdminMedia.mockResolvedValue(detail());
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Открыть: photo.webp" }));
    await flush();
    expect(screen.queryByRole("button", { name: "Скрыть с сайта" })).toBeNull();
    expect(screen.getByText(/Реклама/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Восстановить на сайте" }));
    const dialog = screen.getByRole("dialog", { name: "Восстановить файл" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Это не реклама" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Восстановить" }));
    await flush();

    expect(api.restoreAdminMedia).toHaveBeenCalledWith(FILE, "Это не реклама");
  });

  it("deleting needs a reason AND a tick, and asks for a fresh code when the server wants one", async () => {
    api.listAdminMedia.mockResolvedValue(page([media()]));
    api.getAdminMedia.mockResolvedValue(detail());
    api.deleteAdminMedia
      .mockRejectedValueOnce(new ApiError(403, "mfa_recent_required", "again"))
      .mockResolvedValueOnce({ deleted: true, storageDeleted: true });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Открыть: photo.webp" }));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Удалить файл" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить файл из хранилища" });
    const confirm = within(dialog).getByRole("button", { name: "Удалить навсегда" }) as HTMLButtonElement;
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Нарушение правил" } });
    expect(confirm.disabled).toBe(true); // not ticked yet
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await flush();

    const prompt = screen.getByRole("dialog", { name: "Подтвердите действие кодом" });
    fireEvent.change(within(prompt).getByLabelText("Код из приложения"), { target: { value: "123456" } });
    fireEvent.click(within(prompt).getByRole("button", { name: "Подтвердить" }));
    await flush();

    expect(api.deleteAdminMedia).toHaveBeenCalledTimes(2);
    expect(api.deleteAdminMedia).toHaveBeenLastCalledWith(FILE, "Нарушение правил");
    expect(screen.queryByRole("complementary", { name: "Карточка материала" })).toBeNull();
  });

  it("shows why a delete was refused and keeps the file", async () => {
    api.listAdminMedia.mockResolvedValue(page([media()]));
    api.getAdminMedia.mockResolvedValue(detail());
    api.deleteAdminMedia.mockRejectedValue(new ApiError(409, "file_shared", "Этот файл используется несколькими объектами."));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Открыть: photo.webp" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Удалить файл" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить файл из хранилища" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Нарушение правил" } });
    fireEvent.click(within(dialog).getByRole("checkbox"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить навсегда" }));
    await flush();

    expect(within(screen.getByRole("dialog", { name: "Удалить файл из хранилища" })).getByText(/используется несколькими/)).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Карточка материала" })).toBeTruthy();
  });

  it("opens the card straight from a link (?open=)", async () => {
    window.history.replaceState(null, "", `/admin/moderation?open=${FILE}`);
    api.listAdminMedia.mockResolvedValue(page([media()]));
    api.getAdminMedia.mockResolvedValue(detail());

    await open();

    expect(api.getAdminMedia).toHaveBeenCalledWith(FILE);
    expect(screen.getByRole("complementary", { name: "Карточка материала" })).toBeTruthy();
  });

  it("ignores a link whose id does not look like an id", async () => {
    window.history.replaceState(null, "", "/admin/moderation?open=../../etc/passwd");
    api.listAdminMedia.mockResolvedValue(page([media()]));

    await open();

    expect(api.getAdminMedia).not.toHaveBeenCalled();
  });
});

describe("trainings and listings", () => {
  const training = (): adminApi.AdminTraining => ({
    id: "t1", type: "team", status: "scheduled", trainingDate: "2026-10-20", startTime: "18:00:00", durationMinutes: 90, location: "Зал",
    description: "Отработка ударов", team: { id: "tm", name: "Ястребы" }, creator: { id: USER, name: "Тренер Иван", email: "coach@example.com" },
    participants: 12, bookings: 0, createdAt: "2026-10-01T10:00:00Z",
  });
  const listing = (over: Partial<adminApi.AdminListing> = {}): adminApi.AdminListing => ({
    id: LISTING, title: "Теннис для взрослых", coach: { id: USER, name: "Анна Тренер", email: "anna@example.com" }, coachBlocked: false,
    pricePerSession: 2500, currency: "RUB", location: "Москва", state: "public", moderationReason: null, hiddenBy: null, hiddenAt: null,
    activeBookings: 1, hasPhoto: true, hasVideo: false, createdAt: "2026-10-01T10:00:00Z", description: "Описание", openComplaints: 0, ...over,
  });
  const openPage = async (url: string) => {
    window.history.replaceState(null, "", url);
    render(
      <StepUpProvider>
        <TrainingsPage />
      </StepUpProvider>,
    );
    await flush();
  };

  it("lists trainings read-only, with team, author and participants", async () => {
    api.listAdminTrainings.mockResolvedValue({ total: 1, limit: 25, offset: 0, items: [training()] });

    await openPage("/admin/trainings");

    const table = screen.getByRole("table");
    expect(within(table).getByText("Отработка ударов")).toBeTruthy();
    expect(within(table).getByText("coach@example.com")).toBeTruthy();
    expect(within(table).getByText("12")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Удалить|Скрыть|Отменить/ })).toBeNull();
  });

  it("filters trainings on the server", async () => {
    api.listAdminTrainings.mockResolvedValue({ total: 0, limit: 25, offset: 0, items: [] });
    await openPage("/admin/trainings");

    fireEvent.change(screen.getByLabelText("Статус тренировки"), { target: { value: "completed" } });
    await flush();
    fireEvent.change(screen.getByLabelText("Когда"), { target: { value: "past" } });
    await flush();

    expect(api.listAdminTrainings.mock.calls.at(-1)![0]).toMatchObject({ status: "completed", when: "past" });
  });

  it("switches to listings and hides one with a reason", async () => {
    api.listAdminListings.mockResolvedValue({ total: 1, limit: 25, offset: 0, items: [listing()] });
    api.getAdminListing.mockResolvedValue(listing());
    api.hideAdminListing.mockResolvedValue(listing({ state: "hidden" }));
    await openPage("/admin/trainings?tab=listings");

    fireEvent.click(screen.getByText("Теннис для взрослых"));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть из каталога" }));
    const dialog = screen.getByRole("dialog", { name: "Скрыть объявление" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Ложная информация" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Скрыть" }));
    await flush();

    expect(api.hideAdminListing).toHaveBeenCalledWith(LISTING, "Ложная информация");
  });

  it("explains that a listing with bookings cannot be deleted, instead of silently failing", async () => {
    api.listAdminListings.mockResolvedValue({ total: 1, limit: 25, offset: 0, items: [listing()] });
    api.getAdminListing.mockResolvedValue(listing());
    api.deleteAdminListing.mockRejectedValue(new ApiError(409, "has_active_bookings", "У объявления есть заявки или будущие записи."));
    await openPage("/admin/trainings?tab=listings");
    fireEvent.click(screen.getByText("Теннис для взрослых"));
    await flush();
    expect(screen.getByText(/1 \(ожидают ответа/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    const dialog = screen.getByRole("dialog", { name: "Удалить объявление" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Нарушение правил" } });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Удалить" }));
    await flush();

    expect(within(screen.getByRole("dialog", { name: "Удалить объявление" })).getByText(/заявки или будущие записи/)).toBeTruthy();
  });

  it("a hidden listing offers 'return to the catalogue' and shows why it was hidden", async () => {
    const hidden = listing({ state: "hidden", moderationReason: "Подозрение на обман", hiddenBy: "boss@example.com", hiddenAt: "2026-10-11T10:00:00Z" });
    api.listAdminListings.mockResolvedValue({ total: 1, limit: 25, offset: 0, items: [hidden] });
    api.getAdminListing.mockResolvedValue(hidden);
    await openPage("/admin/trainings?tab=listings");

    fireEvent.click(screen.getByText("Теннис для взрослых"));
    await flush();

    expect(screen.getByText(/Подозрение на обман/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Вернуть в каталог" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Скрыть из каталога" })).toBeNull();
  });
});

describe("the complaints queue", () => {
  const complaint = (over: Partial<adminApi.AdminComplaint> = {}): adminApi.AdminComplaint => ({
    id: COMPLAINT, status: "new", reason: "fraud", comment: "Просят предоплату", createdAt: "2026-10-12T10:00:00Z",
    reporter: { id: "r1", name: "Жалобщик", email: "reporter@example.com" },
    target: { type: "listing", id: LISTING, label: "Теннис для взрослых", state: "visible", owner: { id: USER, name: "Анна Тренер", email: "anna@example.com" } },
    otherOpenOnTarget: 2, handledBy: null, handledAt: null, resolution: null, ...over,
  });
  const openQueue = async (url = "/admin/reports") => {
    window.history.replaceState(null, "", url);
    render(<ComplaintsPage />);
    await flush();
  };

  it("shows the open queue with what is reported and why", async () => {
    api.listAdminComplaints.mockResolvedValue({ total: 1, limit: 25, offset: 0, items: [complaint()] });

    await openQueue();

    const table = screen.getByRole("table");
    expect(within(table).getByText("reporter@example.com")).toBeTruthy();
    expect(within(table).getByText("Теннис для взрослых")).toBeTruthy();
    expect(within(table).getByText("Мошенничество")).toBeTruthy();
    expect(within(table).getByText("Новая")).toBeTruthy();
    expect(within(table).getByText(/и ещё 2 на это же/)).toBeTruthy();
  });

  it("starts from the search in the address (links from other pages)", async () => {
    api.listAdminComplaints.mockResolvedValue({ total: 0, limit: 25, offset: 0, items: [] });

    await openQueue(`/admin/reports?q=${FILE}`);

    expect(api.listAdminComplaints.mock.calls[0]![0]).toMatchObject({ q: FILE });
    expect((screen.getByLabelText("Поиск жалоб") as HTMLInputElement).value).toBe(FILE);
  });

  it("status chips filter on the server", async () => {
    api.listAdminComplaints.mockResolvedValue({ total: 0, limit: 25, offset: 0, items: [] });
    await openQueue();

    fireEvent.click(screen.getByRole("button", { name: "В работе" }));
    await flush();

    expect(api.listAdminComplaints.mock.calls.at(-1)![0]).toMatchObject({ status: "in_progress" });
    expect(screen.getByText("Жалоб нет.")).toBeTruthy();
  });

  it("takes a complaint, then records the decision with a reason; links to the reported thing", async () => {
    api.listAdminComplaints.mockResolvedValue({ total: 1, limit: 25, offset: 0, items: [complaint()] });
    api.takeAdminComplaint.mockResolvedValue(complaint({ status: "in_progress" }));
    api.resolveAdminComplaint.mockResolvedValue(complaint({ status: "resolved" }));
    await openQueue();
    fireEvent.click(screen.getByText("reporter@example.com"));
    await flush();

    const drawer = screen.getByRole("complementary", { name: "Жалоба" });
    expect(within(drawer).getByRole("link", { name: /Открыть объект/ }).getAttribute("href")).toBe(`/admin/trainings?tab=listings&open=${LISTING}`);
    fireEvent.click(within(drawer).getByRole("button", { name: "Взять в работу" }));
    await flush();
    expect(api.takeAdminComplaint).toHaveBeenCalledWith(COMPLAINT);

    fireEvent.click(within(drawer).getByRole("button", { name: "Решена" }));
    const dialog = screen.getByRole("dialog", { name: "Жалоба решена" });
    const confirm = within(dialog).getByRole("button", { name: "Закрыть как решённую" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Объявление скрыто" } });
    fireEvent.click(confirm);
    await flush();

    expect(api.resolveAdminComplaint).toHaveBeenCalledWith(COMPLAINT, "resolved", "Объявление скрыто");
  });

  it("rejecting needs its own explanation", async () => {
    api.listAdminComplaints.mockResolvedValue({ total: 1, limit: 25, offset: 0, items: [complaint()] });
    api.resolveAdminComplaint.mockResolvedValue(complaint({ status: "rejected" }));
    await openQueue();
    fireEvent.click(screen.getByText("reporter@example.com"));
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Отклонить" }));
    const dialog = screen.getByRole("dialog", { name: "Отклонить жалобу" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Нарушений нет" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Отклонить" }));
    await flush();

    expect(api.resolveAdminComplaint).toHaveBeenCalledWith(COMPLAINT, "rejected", "Нарушений нет");
  });

  it("a decided complaint shows the decision and offers no more actions", async () => {
    api.listAdminComplaints.mockResolvedValue({
      total: 1, limit: 25, offset: 0,
      items: [complaint({ status: "resolved", resolution: "Пользователь заблокирован", handledBy: "boss@example.com", handledAt: "2026-10-13T10:00:00Z" })],
    });
    await openQueue();
    fireEvent.click(screen.getByText("reporter@example.com"));
    await flush();

    const drawer = screen.getByRole("complementary", { name: "Жалоба" });
    expect(within(drawer).getByText(/Пользователь заблокирован/)).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: "Решена" })).toBeNull();
    expect(within(drawer).queryByRole("button", { name: "Взять в работу" })).toBeNull();
  });
});

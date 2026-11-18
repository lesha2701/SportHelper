import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "../../api/admin";
import { SupportPage } from "./SupportPage";

vi.mock("../../api/admin");
vi.mock("../../toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const api = vi.mocked(adminApi);

const REQUEST = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const flush = () => act(async () => {});

function request(over: Partial<adminApi.AdminSupportRequest> = {}): adminApi.AdminSupportRequest {
  return {
    id: REQUEST, kind: "question", subject: "Как сменить вид спорта?", body: "Не нахожу, где менять вид спорта.\nПомогите, пожалуйста.",
    status: "new", createdAt: "2026-11-17T10:00:00Z", author: { id: "u1", name: "Анна Игрок", email: "anna@example.com" },
    answer: null, handledBy: null, handledAt: null, ...over,
  };
}
const page = (items: adminApi.AdminSupportRequest[]) => ({ total: items.length, limit: 25, offset: 0, items });

beforeEach(() => {
  Object.values(api).forEach((fn) => typeof fn === "function" && "mockReset" in fn && (fn as ReturnType<typeof vi.fn>).mockReset());
  window.history.replaceState(null, "", "/admin/support");
});
afterEach(cleanup);

const openQueue = async () => {
  render(<SupportPage />);
  await flush();
};
const openFirst = async () => {
  fireEvent.click(screen.getByText("Как сменить вид спорта?"));
  await flush();
};

describe("the support queue", () => {
  it("lists the requests with the author, the kind and the status", async () => {
    api.listAdminSupport.mockResolvedValue(page([request()]));

    await openQueue();

    const table = screen.getByRole("table");
    expect(within(table).getByText("Как сменить вид спорта?")).toBeTruthy();
    expect(within(table).getByText("anna@example.com")).toBeTruthy();
    expect(within(table).getByText("Вопрос")).toBeTruthy();
    expect(within(table).getByText("Новое")).toBeTruthy();
  });

  it("starts from the search in the address and filters by status", async () => {
    api.listAdminSupport.mockResolvedValue(page([]));
    window.history.replaceState(null, "", `/admin/support?q=${REQUEST}`);

    await openQueue();
    expect(api.listAdminSupport.mock.calls[0]![0]).toMatchObject({ q: REQUEST });
    fireEvent.click(screen.getByRole("button", { name: "В работе" }));
    await flush();

    expect(api.listAdminSupport.mock.calls.at(-1)![0]).toMatchObject({ status: "in_progress" });
    expect(screen.getByText("Обращений нет.")).toBeTruthy();
  });

  it("opens a request with its whole text, takes it, and answers it", async () => {
    api.listAdminSupport.mockResolvedValue(page([request()]));
    api.takeAdminSupport.mockResolvedValue(request({ status: "in_progress" }));
    api.answerAdminSupport.mockResolvedValue(request({ status: "answered", answer: "Это в «Профиле»." }));
    await openQueue();
    await openFirst();

    const drawer = screen.getByRole("complementary", { name: "Обращение" });
    expect(within(drawer).getByText(/Не нахожу, где менять вид спорта/)).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: "Взять в работу" }));
    await flush();
    expect(api.takeAdminSupport).toHaveBeenCalledWith(REQUEST);

    fireEvent.click(within(drawer).getByRole("button", { name: "Ответить" }));
    const dialog = screen.getByRole("dialog", { name: "Ответить на обращение" });
    const send = within(dialog).getByRole("button", { name: "Отправить ответ" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true); // an empty answer cannot be sent
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "  Это в «Профиле».  " } });
    fireEvent.click(send);
    await flush();

    expect(api.answerAdminSupport).toHaveBeenCalledWith(REQUEST, "Это в «Профиле».");
  });

  it("closing without an answer asks for a note and sends nothing to the author", async () => {
    api.listAdminSupport.mockResolvedValue(page([request()]));
    api.closeAdminSupport.mockResolvedValue(request({ status: "closed" }));
    await openQueue();
    await openFirst();

    fireEvent.click(screen.getByRole("button", { name: "Закрыть без ответа" }));
    const dialog = screen.getByRole("dialog", { name: "Закрыть без ответа" });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Дубль" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть" }));
    await flush();

    expect(api.closeAdminSupport).toHaveBeenCalledWith(REQUEST, "Дубль");
    expect(api.answerAdminSupport).not.toHaveBeenCalled();
  });

  it("an answered request shows the answer and offers no more actions", async () => {
    api.listAdminSupport.mockResolvedValue(
      page([request({ status: "answered", answer: "Это в «Профиле».", handledBy: "boss@example.com", handledAt: "2026-11-17T12:00:00Z" })]),
    );
    await openQueue();
    await openFirst();

    const drawer = screen.getByRole("complementary", { name: "Обращение" });
    expect(within(drawer).getByText(/Это в «Профиле»\./)).toBeTruthy();
    expect(within(drawer).queryByRole("button", { name: "Ответить" })).toBeNull();
    expect(within(drawer).queryByRole("button", { name: "Взять в работу" })).toBeNull();
  });
});

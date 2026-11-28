import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupportRequest, listMySupportRequests, replyToSupportRequest, type MySupportRequest } from "../../api/support";
import { ApiError } from "../../api/client";
import { SupportScreen } from "./SupportScreen";

vi.mock("../../api/support", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/support")>()),
  createSupportRequest: vi.fn(),
  listMySupportRequests: vi.fn(),
  replyToSupportRequest: vi.fn(),
}));
const flush = () => act(async () => {});

const answered: MySupportRequest = {
  id: "r1", kind: "bug", subject: "Не приходит письмо", body: "Жду подтверждение почты уже час.", status: "answered",
  createdAt: "2026-11-16T10:00:00Z", canReply: true,
  messages: [{ id: "m1", fromStaff: true, body: "Проверьте папку «Спам».", createdAt: "2026-11-16T12:00:00Z" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMySupportRequests).mockResolvedValue([]);
  vi.mocked(createSupportRequest).mockResolvedValue(undefined);
});
afterEach(cleanup);

const fill = (subject: string, body: string) => {
  fireEvent.change(screen.getByPlaceholderText("Коротко: о чём речь"), { target: { value: subject } });
  fireEvent.change(screen.getByPlaceholderText(/Опишите подробно/), { target: { value: body } });
};

describe("the support form", () => {
  it("sends the city and venue details and shows only venue conversations in venue mode", async () => {
    const subject = "Подбор зала: Москва";
    const body = "Нужен крытый корт в субботу.";
    vi.mocked(listMySupportRequests).mockResolvedValue([
      answered,
      { ...answered, id: "venue", kind: "venue_search", subject, body,
        messages: [{ ...answered.messages[0]!, body: "Есть свободный корт в 16:00." }] },
    ]);
    render(<SupportScreen venueSearch onBack={() => {}} />);

    expect(await screen.findByText("Есть свободный корт в 16:00.")).toBeTruthy();
    expect(screen.queryByText(answered.subject)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Город/), { target: { value: " Москва " } });
    fireEvent.change(screen.getByLabelText(/Какой зал нужен/), { target: { value: body } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить заявку" }));
    await flush();
    expect(createSupportRequest).toHaveBeenCalledWith({ kind: "venue_search", subject, body });
    expect(screen.getByText("Заявка отправлена")).toBeTruthy();
  });

  it("offers the kinds as buttons and sends the chosen one with the title and the text", async () => {
    render(<SupportScreen onBack={() => {}} />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Предложение" }));
    expect(screen.getByRole("button", { name: "Предложение" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Вопрос" }).getAttribute("aria-pressed")).toBe("false");
    fill("  Тёмная   тема  ", "Хочу, чтобы тема переключалась сама.\n\nСпасибо!");
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await flush();

    expect(createSupportRequest).toHaveBeenCalledWith({ kind: "suggestion", subject: "Тёмная тема", body: "Хочу, чтобы тема переключалась сама.\n\nСпасибо!" });
  });

  it("thanks the person after sending, and lets them write again", async () => {
    render(<SupportScreen onBack={() => {}} />);
    fill("Вопрос по оплате", "Не понимаю, когда спишутся деньги.");
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await flush();

    expect(screen.getByText(/Спасибо! Мы получили ваше обращение/)).toBeTruthy();
    expect(screen.queryByPlaceholderText("Коротко: о чём речь")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Написать ещё" }));
    expect((screen.getByPlaceholderText("Коротко: о чём речь") as HTMLInputElement).value).toBe(""); // a fresh form
    expect(listMySupportRequests).toHaveBeenCalledTimes(2); // the list is refreshed to show the new one
  });

  it("does not send while the title or the text is too short", async () => {
    render(<SupportScreen onBack={() => {}} />);
    await flush();
    const send = screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement;

    expect(send.disabled).toBe(true);
    fill("ab", "коротко");
    expect(send.disabled).toBe(true);
    fill("Заголовок", "Достаточно длинный текст");
    expect(send.disabled).toBe(false);
  });

  it("keeps what was written and says why when sending fails", async () => {
    vi.mocked(createSupportRequest).mockRejectedValue(new ApiError(429, "rate_limited", "Слишком много запросов. Попробуйте позже."));
    render(<SupportScreen onBack={() => {}} />);
    fill("Заголовок", "Достаточно длинный текст");

    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await flush();

    expect(screen.getByText("Слишком много запросов. Попробуйте позже.")).toBeTruthy();
    expect((screen.getByPlaceholderText("Коротко: о чём речь") as HTMLInputElement).value).toBe("Заголовок");
    expect(screen.queryByText(/Мы получили ваше обращение/)).toBeNull();
  });

  it("shows the person's earlier requests with the answer to them", async () => {
    vi.mocked(listMySupportRequests).mockResolvedValue([answered]);

    render(<SupportScreen onBack={() => {}} />);
    await flush();

    expect(screen.getByText("Ваши обращения")).toBeTruthy();
    expect(screen.getByText("Не приходит письмо")).toBeTruthy();
    expect(screen.getByText("Есть ответ")).toBeTruthy();
    expect(screen.getByText("Проверьте папку «Спам».")).toBeTruthy();
  });

  it("lets the person answer the support, and shows the whole conversation after that", async () => {
    vi.mocked(listMySupportRequests).mockResolvedValue([answered]);
    vi.mocked(replyToSupportRequest).mockResolvedValue({
      ...answered,
      status: "new",
      messages: [...answered.messages, { id: "m2", fromStaff: false, body: "Проверил, там пусто.", createdAt: "2026-11-16T13:00:00Z" }],
    });
    render(<SupportScreen onBack={() => {}} />);
    await flush();

    const field = screen.getByLabelText("Сообщение в обращении «Не приходит письмо»") as HTMLTextAreaElement;
    const send = screen.getByRole("button", { name: "Отправить сообщение" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "  Проверил, там пусто.  " } });
    fireEvent.click(send);
    await flush();

    expect(replyToSupportRequest).toHaveBeenCalledWith("r1", "Проверил, там пусто.");
    expect(screen.getByText("Проверил, там пусто.")).toBeTruthy(); // the reply sits in the thread...
    expect(screen.getByText("Проверьте папку «Спам».")).toBeTruthy(); // ...under the earlier answer
    expect(screen.getByText("Отправлено")).toBeTruthy(); // back to waiting for the administrators
    expect((screen.getByLabelText("Сообщение в обращении «Не приходит письмо»") as HTMLTextAreaElement).value).toBe(""); // the field is emptied
  });

  it("keeps the draft and says why when the reply cannot be sent", async () => {
    vi.mocked(listMySupportRequests).mockResolvedValue([answered]);
    vi.mocked(replyToSupportRequest).mockRejectedValue(new ApiError(409, "closed", "Обращение закрыто. Если нужна помощь, создайте новое."));
    render(<SupportScreen onBack={() => {}} />);
    await flush();

    fireEvent.change(screen.getByLabelText("Сообщение в обращении «Не приходит письмо»"), { target: { value: "Ещё один вопрос" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await flush();

    expect(screen.getByText("Обращение закрыто. Если нужна помощь, создайте новое.")).toBeTruthy();
    expect((screen.getByLabelText("Сообщение в обращении «Не приходит письмо»") as HTMLTextAreaElement).value).toBe("Ещё один вопрос");
  });

  it("a closed request has no reply field and says so", async () => {
    vi.mocked(listMySupportRequests).mockResolvedValue([{ ...answered, status: "closed", canReply: false }]);
    render(<SupportScreen onBack={() => {}} />);
    await flush();

    expect(screen.queryByRole("button", { name: "Отправить сообщение" })).toBeNull();
    expect(screen.getByText(/Обращение закрыто/)).toBeTruthy();
  });

  it("the arrow goes back", async () => {
    const onBack = vi.fn();
    render(<SupportScreen onBack={onBack} />);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Назад" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

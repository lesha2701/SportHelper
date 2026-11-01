import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/client";
import { deleteChatMessage, getChat, listChatMessages, markChatRead, openChat, sendChatMedia, sendChatMessage } from "../../api/chat";
import type { ChatConversation, ChatMessage } from "../../types/chat";
import { ChatScreen } from "./ChatScreen";

vi.mock("../../api/chat", () => ({
  openChat: vi.fn(),
  getChat: vi.fn(),
  listChatMessages: vi.fn(),
  sendChatMessage: vi.fn(),
  sendChatMedia: vi.fn(),
  deleteChatMessage: vi.fn(),
  markChatRead: vi.fn(() => Promise.resolve()),
}));
vi.mock("../shared/AuthenticatedImage", () => ({ AuthenticatedImage: ({ fileId }: { fileId: string }) => <img data-testid="photo" data-file={fileId} alt="" /> }));
vi.mock("../shared/AuthenticatedVideo", () => ({ AuthenticatedVideo: ({ fileId }: { fileId: string }) => <div data-testid="video" data-file={fileId} /> }));
vi.mock("../shared/pendingMedia", () => ({
  checkVideo: vi.fn(() => Promise.resolve(null)),
  usePreviewUrl: () => "blob:preview",
}));
import { checkVideo } from "../shared/pendingMedia";

const ME = "me";
const chat = (over: Partial<ChatConversation> = {}): ChatConversation => ({
  id: "c1", kind: "booking", bookingId: "b1", teamId: null, title: "Анна Тренер", subtitle: "Теннис · 02.11.2026 10:00 (UTC)",
  canSend: true, sendBlockedReason: null, canModerate: false, ...over,
});
const msg = (id: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, senderId: "other", senderName: "Анна Тренер", body: `сообщение ${id}`, attachment: null, createdAt: new Date().toISOString(), deleted: false, ...over,
});
const page = (items: ChatMessage[], hasMoreBefore = false) => Promise.resolve({ items, hasMoreBefore });
const flush = () => act(async () => {});

let uuid = 0;
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  uuid = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `key-${++uuid}` });
  vi.mocked(markChatRead).mockResolvedValue(undefined);
  Element.prototype.scrollTo = () => {};
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function open(over: Partial<ChatConversation> = {}, messages: ChatMessage[] = [msg(1), msg(2)], props: { embedded?: boolean } = {}) {
  vi.mocked(openChat).mockResolvedValue(chat(over));
  vi.mocked(listChatMessages).mockReturnValue(page(messages));
  return render(<ChatScreen token="t" target={{ kind: "booking", id: "b1" }} myUserId={ME} onBack={() => {}} {...props} />);
}
const box = () => screen.getByRole("textbox", { name: "Сообщение" }) as HTMLTextAreaElement;

describe("opening a chat", () => {
  it("shows who it is with, the lesson, and the messages, and marks them read", async () => {
    open();
    await flush();
    expect(screen.getByRole("heading", { name: "Анна Тренер" })).toBeTruthy();
    expect(screen.getByText(/Теннис/)).toBeTruthy();
    expect(screen.getByText("сообщение 1")).toBeTruthy();
    expect(markChatRead).toHaveBeenCalledWith("t", "c1", 2);
  });

  it("explains why a chat cannot be opened yet instead of showing an empty screen", async () => {
    vi.mocked(openChat).mockRejectedValue(new ApiError(409, "chat_not_available", "Чат откроется после оплаты тренировки."));
    render(<ChatScreen token="t" target={{ kind: "booking", id: "b1" }} myUserId={ME} onBack={() => {}} />);
    await flush();
    expect(screen.getByText("Чат откроется после оплаты тренировки.")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows nothing to write into when sending is closed, and says why", async () => {
    open({ canSend: false, sendBlockedReason: "Чат откроется после оплаты тренировки." });
    await flush();
    expect(screen.queryByRole("textbox", { name: "Сообщение" })).toBeNull();
    expect(screen.getByText("Чат откроется после оплаты тренировки.")).toBeTruthy();
  });

  it("names the sender only in a team chat", async () => {
    open({ kind: "team", bookingId: null, teamId: "t1", title: "Ястребы" });
    await flush();
    expect(screen.getAllByText("Анна Тренер").length).toBeGreaterThan(0);
    cleanup();
    open();
    await flush();
    expect(screen.queryAllByText("Анна Тренер")).toHaveLength(1); // the heading only
  });

  it("has no header or back button of its own when it sits inside a team's tab", async () => {
    open({}, [msg(1)], { embedded: true });
    await flush();
    expect(screen.queryByRole("button", { name: "Назад" })).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });
});

describe("sending", () => {
  it("sends the text, clears the box and shows the message", async () => {
    open();
    await flush();
    vi.mocked(sendChatMessage).mockResolvedValue(msg(3, { senderId: ME, senderName: "Я", body: "Привет!" }));
    fireEvent.change(box(), { target: { value: "  Привет!  " } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await flush();

    expect(sendChatMessage).toHaveBeenCalledWith("t", "c1", "Привет!", "key-1");
    expect(screen.getByText("Привет!")).toBeTruthy();
    expect(box().value).toBe("");
  });

  it("does not send an empty message", async () => {
    open();
    await flush();
    expect((screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box(), { target: { value: "   " } });
    expect((screen.getByRole("button", { name: "Отправить" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sends with Enter and breaks the line with Shift+Enter", async () => {
    open();
    await flush();
    vi.mocked(sendChatMessage).mockResolvedValue(msg(3, { senderId: ME, body: "a" }));
    fireEvent.change(box(), { target: { value: "a" } });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(sendChatMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    await flush();
    expect(sendChatMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps the text and the SAME key when sending fails, so a retry cannot duplicate the message", async () => {
    open();
    await flush();
    vi.mocked(sendChatMessage).mockRejectedValueOnce(new ApiError(0, "network_error", "Не удалось связаться с сервером"));
    fireEvent.change(box(), { target: { value: "важное" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await flush();
    expect(screen.getByText("Не удалось связаться с сервером")).toBeTruthy();
    expect(box().value).toBe("важное");

    vi.mocked(sendChatMessage).mockResolvedValue(msg(3, { senderId: ME, body: "важное" }));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await flush();

    expect(vi.mocked(sendChatMessage).mock.calls.map((c) => c[3])).toEqual(["key-1", "key-1"]);
    fireEvent.change(box(), { target: { value: "следующее" } });
    vi.mocked(sendChatMessage).mockResolvedValue(msg(4, { senderId: ME, body: "следующее" }));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await flush();
    expect(vi.mocked(sendChatMessage).mock.calls[2]?.[3]).toBe("key-2"); // a new message gets a new key
  });

  it("disables sending while a message is on its way (a double click sends once)", async () => {
    open();
    await flush();
    let finish: (m: ChatMessage) => void = () => {};
    vi.mocked(sendChatMessage).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    fireEvent.change(box(), { target: { value: "раз" } });
    const send = screen.getByRole("button", { name: "Отправить" });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(sendChatMessage).toHaveBeenCalledTimes(1);
    await act(async () => finish(msg(3, { senderId: ME, body: "раз" })));
  });

  it("re-reads the chat when the server says it has closed for writing", async () => {
    open();
    await flush();
    vi.mocked(sendChatMessage).mockRejectedValue(new ApiError(409, "chat_closed", "Чат откроется после оплаты тренировки."));
    vi.mocked(getChat).mockResolvedValue(chat({ canSend: false, sendBlockedReason: "Оплата возвращена." }));
    fireEvent.change(box(), { target: { value: "поздно" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await flush();
    expect(screen.getByText("Оплата возвращена.")).toBeTruthy();
  });
});

describe("photos and videos", () => {
  const input = () => document.querySelector('input[type="file"]') as HTMLInputElement;

  it("sends a picked photo with its caption through the media endpoint", async () => {
    open();
    await flush();
    const photo = new File(["x"], "форма.jpg", { type: "image/jpeg" });
    fireEvent.change(input(), { target: { files: [photo] } });
    await flush();
    expect(screen.getByText("форма.jpg")).toBeTruthy();

    vi.mocked(sendChatMedia).mockResolvedValue(msg(3, { senderId: ME, body: "Вот", attachment: { kind: "photo", fileId: "f1", filename: "форма.webp", hasThumb: true } }));
    fireEvent.change(box(), { target: { value: "Вот" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await flush();

    expect(sendChatMedia).toHaveBeenCalledWith("t", "c1", photo, "Вот", "key-1");
    expect(screen.getByTestId("photo").getAttribute("data-file")).toBe("f1");
    expect(screen.queryByText("форма.jpg")).toBeNull(); // the pending attachment is cleared
  });

  it("rejects a too long or too big video before uploading it", async () => {
    open();
    await flush();
    vi.mocked(checkVideo).mockResolvedValueOnce("Видео должно быть короче 1 минуты.");
    fireEvent.change(input(), { target: { files: [new File(["x"], "long.mp4", { type: "video/mp4" })] } });
    await flush();
    expect(screen.getByText("Видео должно быть короче 1 минуты.")).toBeTruthy();
    expect(screen.queryByText("long.mp4")).toBeNull();
    expect(sendChatMedia).not.toHaveBeenCalled();
  });

  it("shows a video message as a video", async () => {
    open({}, [msg(1, { attachment: { kind: "video", fileId: "v1", filename: "x.mp4", hasThumb: false } })]);
    await flush();
    expect(screen.getByTestId("video").getAttribute("data-file")).toBe("v1");
  });

  it("shows the server's reason for a refused file", async () => {
    open();
    await flush();
    fireEvent.change(input(), { target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] } });
    await flush();
    vi.mocked(sendChatMedia).mockRejectedValue(new ApiError(413, "file_too_large", "Файл слишком большой: максимум 10 МБ."));
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    await flush();
    expect(screen.getByText("Файл слишком большой: максимум 10 МБ.")).toBeTruthy();
  });
});

describe("new messages and older ones", () => {
  it("asks only for what is new, every few seconds, and marks it read", async () => {
    open();
    await flush();
    vi.mocked(listChatMessages).mockReturnValue(page([msg(3, { body: "новое от тренера" })]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(listChatMessages).toHaveBeenLastCalledWith("t", "c1", { afterId: 2 });
    expect(screen.getByText("новое от тренера")).toBeTruthy();
    expect(markChatRead).toHaveBeenLastCalledWith("t", "c1", 3);
  });

  it("does not poll while the tab is in the background", async () => {
    open();
    await flush();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
    expect(vi.mocked(listChatMessages)).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("stops asking once the screen is closed", async () => {
    const view = open();
    await flush();
    view.unmount();
    vi.mocked(listChatMessages).mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(listChatMessages).not.toHaveBeenCalled();
  });

  it("loads the page before the oldest message on request, without duplicating anything", async () => {
    open({}, [msg(31), msg(32)]);
    vi.mocked(listChatMessages).mockReturnValueOnce(page([msg(31), msg(32)], true));
    await flush();
    vi.mocked(listChatMessages).mockReturnValueOnce(page([msg(29), msg(30)], false));
    fireEvent.click(screen.getByRole("button", { name: "Показать более ранние" }));
    await flush();
    expect(listChatMessages).toHaveBeenLastCalledWith("t", "c1", { beforeId: 31, limit: 30 });
    expect(screen.getAllByText(/сообщение \d+/).map((e) => e.textContent)).toEqual(["сообщение 29", "сообщение 30", "сообщение 31", "сообщение 32"]);
    expect(screen.queryByRole("button", { name: "Показать более ранние" })).toBeNull();
  });
});

describe("deleting", () => {
  it("offers deleting my own message only, after a confirmation, and shows it as deleted", async () => {
    open({}, [msg(1), msg(2, { senderId: ME, body: "моё" })]);
    await flush();
    expect(screen.getAllByRole("button", { name: "Удалить" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    vi.mocked(deleteChatMessage).mockResolvedValue(undefined);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить" }));
    await flush();

    expect(deleteChatMessage).toHaveBeenCalledWith("t", "c1", 2);
    expect(screen.getByText("Сообщение удалено")).toBeTruthy();
    expect(screen.queryByText("моё")).toBeNull();
  });

  it("lets a team's coach delete anyone's message", async () => {
    open({ kind: "team", bookingId: null, teamId: "t1", title: "Ястребы", canModerate: true }, [msg(1), msg(2)]);
    await flush();
    expect(screen.getAllByRole("button", { name: "Удалить" })).toHaveLength(2);
  });

  it("shows no way to delete a message that is already deleted", async () => {
    open({}, [msg(1, { senderId: ME, deleted: true, body: null })]);
    await flush();
    expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
    await waitFor(() => expect(screen.getByText("Сообщение удалено")).toBeTruthy());
  });
});

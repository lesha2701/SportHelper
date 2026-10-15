import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createComplaint } from "../../api/admin";
import { ApiError } from "../../api/client";
import { ReportButton } from "./ReportButton";

vi.mock("../../api/admin", () => ({ createComplaint: vi.fn() }));

let auth: { state: unknown } | null = null;
vi.mock("../../context/AuthContext", () => ({ useOptionalAuth: () => auth }));

const createMock = vi.mocked(createComplaint);
const signedIn = (id = "me") => ({ state: { status: "ready", user: { id } } });
const flush = () => act(async () => {});

beforeEach(() => {
  createMock.mockReset();
  auth = signedIn();
});
afterEach(cleanup);

describe("the report button", () => {
  it("is not shown to a visitor who is not signed in", () => {
    auth = { state: { status: "loading" } };
    render(<ReportButton targetType="user" targetId="t1" />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is not shown without any auth provider at all", () => {
    auth = null;
    render(<ReportButton targetType="user" targetId="t1" />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is not shown on a person's own profile or content", () => {
    render(<ReportButton targetType="user" targetId="me" ownerUserId="me" />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("asks for a reason and only then lets the complaint go", async () => {
    createMock.mockResolvedValue();
    render(<ReportButton targetType="listing" targetId="L1" ownerUserId="coach" label="Пожаловаться на объявление" />);

    fireEvent.click(screen.getByRole("button", { name: "Пожаловаться на объявление" }));
    const dialog = screen.getByRole("dialog", { name: "Пожаловаться на объявление" });
    const send = within(dialog).getByRole("button", { name: "Отправить" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.click(within(dialog).getByLabelText("Мошенничество"));
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "  Просят деньги заранее " } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await flush();

    expect(createMock).toHaveBeenCalledWith({ targetType: "listing", targetId: "L1", reason: "fraud", comment: "Просят деньги заранее" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'другая причина' needs a description", () => {
    render(<ReportButton targetType="user" targetId="u2" ownerUserId="u2" />);
    fireEvent.click(screen.getByRole("button", { name: "Пожаловаться" }));
    const dialog = screen.getByRole("dialog");
    const send = within(dialog).getByRole("button", { name: "Отправить" }) as HTMLButtonElement;

    fireEvent.click(within(dialog).getByLabelText("Другая причина"));
    expect(send.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "ab" } });
    expect(send.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Выдаёт себя за другого" } });
    expect(send.disabled).toBe(false);
  });

  it("keeps the dialog open and shows why when the server refuses (e.g. a duplicate)", async () => {
    createMock.mockRejectedValue(new ApiError(409, "already_reported", "Вы уже отправили жалобу на это — мы её рассматриваем."));
    render(<ReportButton targetType="user" targetId="u2" ownerUserId="u2" />);
    fireEvent.click(screen.getByRole("button", { name: "Пожаловаться" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText("Спам"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Отправить" }));
    await flush();

    expect(within(screen.getByRole("dialog")).getByText(/уже отправили жалобу/)).toBeTruthy();
  });

  it("can be cancelled without sending anything", () => {
    render(<ReportButton targetType="media" targetId="f1" ownerUserId="u2" iconOnly label="Пожаловаться на материал" />);
    fireEvent.click(screen.getByRole("button", { name: "Пожаловаться на материал" }));

    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createMock).not.toHaveBeenCalled();
  });
});

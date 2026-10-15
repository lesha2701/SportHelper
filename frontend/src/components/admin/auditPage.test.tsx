import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAdminAudit, type AuditEntry } from "../../api/admin";
import { AuditPage } from "./AuditPage";

vi.mock("../../api/admin", () => ({ listAdminAudit: vi.fn() }));
const auditMock = vi.mocked(listAdminAudit);
const flush = () => act(async () => {});

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  id: "e1", action: "ban", targetType: "user", targetId: "11111111-1111-4111-8111-111111111111", reason: "Спам в профиле",
  result: "success", createdAt: "2026-10-14T10:00:00Z", admin: "boss@example.com",
  details: { before: { blocked: false }, after: { blocked: true, reason: "Спам в профиле" }, days: 7 }, ...over,
});

beforeEach(() => auditMock.mockReset());
afterEach(cleanup);

const open = async (items: AuditEntry[]) => {
  auditMock.mockResolvedValue({ total: items.length, limit: 50, offset: 0, items });
  render(<AuditPage />);
  await flush();
};

describe("the audit trail", () => {
  it("shows who did what to which object, and why", async () => {
    await open([entry()]);

    const table = screen.getByRole("table");
    expect(within(table).getByText("boss@example.com")).toBeTruthy();
    expect(within(table).getByText("Блокировка пользователя")).toBeTruthy();
    expect(within(table).getByText("Спам в профиле")).toBeTruthy();
    expect(within(table).getByText("выполнено")).toBeTruthy();
    expect(within(table).getByRole("link", { name: "11111111…" }).getAttribute("href")).toBe("/admin/users?open=11111111-1111-4111-8111-111111111111");
  });

  it("expands to show the state before and after", async () => {
    await open([entry()]);

    fireEvent.click(within(screen.getByRole("table")).getByText("Блокировка пользователя"));

    expect(screen.getByText("До")).toBeTruthy();
    expect(screen.getByText("После")).toBeTruthy();
    expect(screen.getAllByText("blocked").length).toBe(2);
    expect(screen.getByText("days")).toBeTruthy();
  });

  it("marks refused attempts as such", async () => {
    await open([entry({ result: "denied", reason: null, details: { why: "self" } })]);

    expect(within(screen.getByRole("table")).getByText("отказано")).toBeTruthy();
  });

  it("sends the filters to the server and starts from the first page", async () => {
    await open([entry()]);

    fireEvent.change(screen.getByLabelText("Действие"), { target: { value: "media_delete" } });
    await flush();
    fireEvent.change(screen.getByLabelText("Результат"), { target: { value: "failed" } });
    await flush();

    expect(auditMock.mock.calls.at(-1)![0]).toMatchObject({ action: "media_delete", result: "failed", offset: 0, limit: 50 });
  });

  it("is read-only: nothing on the page edits or removes an entry", async () => {
    await open([entry()]);

    expect(screen.queryByRole("button", { name: /удалить|изменить|редактировать/i })).toBeNull();
  });

  it("says so when there is nothing yet", async () => {
    await open([]);

    expect(screen.getByText("Записей нет.")).toBeTruthy();
  });
});

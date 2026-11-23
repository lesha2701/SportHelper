import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as adminApi from "../../api/admin";
import * as blogApi from "../../api/blog";
import { AdminContext } from "./adminUi";
import { BlogPostsPage } from "./BlogPostsPage";

vi.mock("../../api/admin");
vi.mock("../../api/blog", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../api/blog")>()), listComments: vi.fn() }));
vi.mock("../../toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => <div data-testid="photo" /> }));
const api = vi.mocked(adminApi);

const ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const flush = () => act(async () => {});

function row(over: Partial<adminApi.AdminPostRow> = {}): adminApi.AdminPostRow {
  return {
    id: ID, title: "Как разминаться", sport: "Футбол", status: "pending", flags: [], authorId: "u1", authorName: "Иван", authorEmail: "ivan@example.com",
    authorTrusted: false, submittedAt: "2026-11-23T10:00:00Z", publishedAt: null, reviewedBy: null, rejectReason: null, openComplaints: 0, ...over,
  };
}
const full = (over: Partial<adminApi.AdminPost> = {}): adminApi.AdminPost => ({
  ...row(), blocks: [{ type: "paragraph", text: "Текст статьи" }], imageIds: ["f1"], likesCount: 0, commentsCount: 0, ...over,
});
const page = (items: adminApi.AdminPostRow[]) => ({ total: items.length, limit: 25, offset: 0, items });

beforeEach(() => {
  Object.values(api).forEach((fn) => typeof fn === "function" && "mockReset" in fn && (fn as ReturnType<typeof vi.fn>).mockReset());
  vi.mocked(blogApi.listComments).mockResolvedValue([]);
  window.history.replaceState(null, "", "/admin/blog");
});
afterEach(cleanup);

const open = async () => {
  render(
    <AdminContext.Provider value={{ recheck: () => {}, finance: false }}>
      <BlogPostsPage />
    </AdminContext.Provider>,
  );
  await flush();
};

describe("the articles queue", () => {
  it("starts with the articles waiting for approval", async () => {
    api.listAdminPosts.mockResolvedValue(page([row({ flags: ["promo_words"] })]));
    await open();
    expect(api.listAdminPosts.mock.calls[0]![0]).toMatchObject({ status: "pending" });
    const table = screen.getByRole("table");
    expect(within(table).getByText("Как разминаться")).toBeTruthy();
    expect(within(table).getByText("проверить")).toBeTruthy();
  });

  it("approves an article from its card", async () => {
    api.listAdminPosts.mockResolvedValue(page([row()]));
    api.getAdminPost.mockResolvedValue(full());
    api.approveAdminPost.mockResolvedValue(full({ status: "published" }));
    await open();
    fireEvent.click(screen.getByText("Как разминаться"));
    await flush();
    expect(screen.getByText("Текст статьи")).toBeTruthy();
    expect(screen.getByTestId("photo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));
    await flush();
    expect(api.approveAdminPost).toHaveBeenCalledWith(ID);
  });

  it("rejects only with a reason", async () => {
    api.listAdminPosts.mockResolvedValue(page([row()]));
    api.getAdminPost.mockResolvedValue(full());
    api.rejectAdminPost.mockResolvedValue(full({ status: "rejected" }));
    await open();
    fireEvent.click(screen.getByText("Как разминаться"));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Отклонить" }));
    const confirm = screen.getAllByRole("button", { name: "Отклонить" }).at(-1)!;
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Это реклама" } });
    fireEvent.click(confirm);
    await flush();
    expect(api.rejectAdminPost).toHaveBeenCalledWith(ID, "Это реклама");
  });

  it("marks the author as trusted", async () => {
    api.listAdminPosts.mockResolvedValue(page([row()]));
    api.getAdminPost.mockResolvedValue(full());
    api.setAuthorTrusted.mockResolvedValue(undefined);
    await open();
    fireEvent.click(screen.getByText("Как разминаться"));
    await flush();
    fireEvent.click(screen.getByRole("checkbox", { name: /Без модерации администратором/ }));
    await flush();
    expect(api.setAuthorTrusted).toHaveBeenCalledWith("u1", true);
  });
});

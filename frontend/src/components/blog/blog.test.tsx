import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as blogApi from "../../api/blog";
import type { Post, PostCard } from "../../api/blog";
import { renderInline, wrapSelection, blocksLength, PostBody } from "./blogText";
import { FeaturedPost } from "./FeaturedPost";
import { PostPage } from "./PostPage";

vi.mock("../shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => <div data-testid="photo" /> }));
vi.mock("../shared/ReportButton", () => ({ ReportButton: () => null }));
let signedIn = true;
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ state: signedIn ? { status: "ready", user: { id: "me" } } : { status: "guest" } }),
  useOptionalAuth: () => null,
}));
vi.mock("../../api/blog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/blog")>()),
  featuredPost: vi.fn(),
  getPost: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
  setLike: vi.fn(),
  countView: vi.fn(),
  deletePost: vi.fn(),
}));

const author = { id: "a1", name: "Иван Тренер", isCoach: true, isPro: false, profileOpen: true, avatarFileId: null };
const card: PostCard = {
  id: "p1", title: "Как разминаться", sport: "Футбол", excerpt: "Начните с суставов", coverFileId: null, imagesCount: 0, author,
  likesCount: 3, commentsCount: 1, viewsCount: 10, publishedAt: "2026-11-20T10:00:00Z", likedByMe: false,
};
const post: Post = {
  ...card, status: "published", blocks: [{ type: "paragraph", text: "Текст **важный**" }], imageIds: ["f1", "f2"], listing: null, bookmarkedByMe: false,
  isMine: false, rejectReason: null, flags: [], updatedAt: "2026-11-20T10:00:00Z", sentForReview: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  signedIn = true;
  vi.mocked(blogApi.listComments).mockResolvedValue([]);
  vi.mocked(blogApi.countView).mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("the text format", () => {
  it("shows **bold** and *italic* as elements and everything else as plain text", () => {
    const { container } = render(<p>{renderInline("a **жирно** и *косо* <b>не html</b> * одиночная")}</p>);
    expect(container.querySelector("strong")?.textContent).toBe("жирно");
    expect(container.querySelector("em")?.textContent).toBe("косо");
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<b>не html</b> * одиночная");
  });

  it("wraps a selection in markers and unwraps it again", () => {
    expect(wrapSelection("слово тут", 0, 5, "**")).toEqual({ value: "**слово** тут", start: 2, end: 7 });
    expect(wrapSelection("**слово** тут", 0, 9, "**")).toEqual({ value: "слово тут", start: 0, end: 5 });
    expect(wrapSelection("", 0, 0, "*")).toEqual({ value: "**", start: 1, end: 1 });
  });

  it("counts the text without the markers", () => {
    expect(blocksLength([{ type: "paragraph", text: "**ab** c" }, { type: "list", items: ["*x*", "yz"] }])).toBe(7);
  });

  it("renders every kind of block", () => {
    const { container } = render(
      <PostBody blocks={[{ type: "heading", text: "Раздел" }, { type: "quote", text: "Цитата" }, { type: "list", items: ["один", "два"] }]} />,
    );
    expect(container.querySelector("h2")?.textContent).toBe("Раздел");
    expect(container.querySelector("blockquote")?.textContent).toBe("Цитата");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });
});

describe("the home block", () => {
  it("shows the article of the day with a link to the feed on its sport", async () => {
    vi.mocked(blogApi.featuredPost).mockResolvedValue(card);
    render(<FeaturedPost />);
    expect(await screen.findByText("Как разминаться")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Все статьи/ }).getAttribute("href")).toBe("/blog?sport=%D0%A4%D1%83%D1%82%D0%B1%D0%BE%D0%BB&sort=popular");
  });

  it("invites the first author when there are no articles", async () => {
    vi.mocked(blogApi.featuredPost).mockResolvedValue(null);
    render(<FeaturedPost />);
    expect(await screen.findByText(/Напишите первую/)).toBeTruthy();
  });
});

describe("an article", () => {
  it("is readable by a guest, who cannot like but is asked to sign in", async () => {
    signedIn = false;
    vi.mocked(blogApi.getPost).mockResolvedValue(post);
    render(<PostPage postId="p1" />);
    expect(await screen.findByRole("heading", { name: "Как разминаться" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Войдите" })).toBeTruthy();
    expect(blogApi.countView).not.toHaveBeenCalled(); // guests' views are not counted
    expect(screen.queryByRole("button", { name: "Ещё" })?.getAttribute("aria-haspopup")).toBe("menu");
  });

  it("counts the view of a signed-in reader and likes", async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue(post);
    vi.mocked(blogApi.setLike).mockResolvedValue({ liked: true, likesCount: 4 });
    render(<PostPage postId="p1" />);
    const like = await screen.findByRole("button", { name: /♡ 3/ });
    await waitFor(() => expect(blogApi.countView).toHaveBeenCalledWith("p1"));
    fireEvent.click(like);
    expect(await screen.findByRole("button", { name: /♥ 4/ })).toBeTruthy();
  });

  it("does not count the author's own view and offers edit and delete in the menu", async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue({ ...post, isMine: true });
    render(<PostPage postId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ещё" }));
    expect(screen.getByRole("menuitem", { name: "Изменить" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Удалить" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Скрыть автора" })).toBeNull();
    expect(blogApi.countView).not.toHaveBeenCalled();
  });

  it("offers a reader save, hide and hide-author", async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue(post);
    render(<PostPage postId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ещё" }));
    for (const name of ["Скопировать ссылку", "Сохранить", "Скрыть статью", "Скрыть автора"]) expect(screen.getByRole("menuitem", { name })).toBeTruthy();
  });

  it("shows the attached listing with a «Записаться» button", async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue({
      ...post, listing: { id: "l1", title: "Футбол для взрослых", pricePerSession: 2500, currency: "RUB", photoFileId: null, coachUserId: "a1" },
    });
    render(<PostPage postId="p1" />);
    const link = await screen.findByRole("link", { name: "Записаться" });
    expect(link.getAttribute("href")).toBe("/coaches?listing=l1");
  });

  it("tells the author why an article is not public", async () => {
    vi.mocked(blogApi.getPost).mockResolvedValue({ ...post, isMine: true, status: "rejected", rejectReason: "Похоже на рекламу" });
    render(<PostPage postId="p1" />);
    expect(await screen.findByText(/Похоже на рекламу/)).toBeTruthy();
    expect(screen.queryByLabelText("Комментарии")).toBeNull(); // no comments under an article nobody can read
  });

  it("says the article is not found", async () => {
    const { ApiError } = await import("../../api/client");
    vi.mocked(blogApi.getPost).mockRejectedValue(new ApiError(404, "post_not_found", "Статья не найдена."));
    render(<PostPage postId="p1" />);
    expect(await screen.findByText("Статья не найдена")).toBeTruthy();
  });
});

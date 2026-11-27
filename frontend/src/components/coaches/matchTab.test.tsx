import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listListings } from "../../api/coachListings";
import { listMyMatchRequests } from "../../api/matchRequests";
import { CoachMarketplaceScreen } from "./CoachMarketplaceScreen";

vi.mock("../../api/coachListings", () => ({
  listListings: vi.fn(),
  recordListingView: vi.fn().mockResolvedValue(1),
  getListingProfile: vi.fn(),
  getListingOpenSlots: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../api/coaches", () => ({
  getCoachPublicProfile: vi.fn(() => new Promise(() => {})),
  listCoachPublicListings: vi.fn(() => new Promise(() => {})),
  listCoachPublicReviews: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../api/bookings", () => ({ createBooking: vi.fn() }));
vi.mock("../../api/matchRequests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/matchRequests")>()),
  listMyMatchRequests: vi.fn(),
  createMatchRequest: vi.fn(),
  cancelMatchRequest: vi.fn(),
}));
vi.mock("../../hooks/useIsDesktop", () => ({ useIsDesktop: () => false }));
vi.mock("../shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => <div /> }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listListings).mockResolvedValue([]);
  vi.mocked(listMyMatchRequests).mockResolvedValue([]);
});
afterEach(cleanup);

describe("the «Подобрать тренера» tab", () => {
  it("switches between the catalogue and the form", async () => {
    render(<CoachMarketplaceScreen token="t" myUserId="u1" />);
    expect(screen.getByRole("button", { name: "Каталог" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Подобрать тренера" }));
    expect(await screen.findByPlaceholderText("Например: теннис")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Подобрать тренера" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Каталог" }));
    expect(await screen.findByText("Фильтры")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Например: теннис")).toBeNull();
  });

  it("asks a visitor without an account to sign in instead of showing the form", async () => {
    render(<CoachMarketplaceScreen token="" guest onRequireLogin={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Подобрать тренера" }));

    expect(await screen.findByRole("button", { name: "Войти" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Например: теннис")).toBeNull();
    expect(listMyMatchRequests).not.toHaveBeenCalled();
  });
});

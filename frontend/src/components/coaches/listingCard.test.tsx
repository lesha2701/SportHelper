import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listListings } from "../../api/coachListings";
import type { CoachListingCard } from "../../types/coachListing";
import { CoachMarketplaceScreen } from "./CoachMarketplaceScreen";

vi.mock("../../api/coachListings", () => ({
  listListings: vi.fn(),
  getListingProfile: vi.fn(),
  getListingOpenSlots: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../api/coaches", () => ({
  getCoachPublicProfile: vi.fn(() => new Promise(() => {})),
  listCoachPublicListings: vi.fn(() => new Promise(() => {})),
  listCoachPublicReviews: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../api/bookings", () => ({ createBooking: vi.fn() }));
vi.mock("../../hooks/useIsDesktop", () => ({ useIsDesktop: () => false }));
vi.mock("../shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => <div data-testid="photo" /> }));
vi.mock("../shared/AuthenticatedVideo", () => ({ AuthenticatedVideo: () => <div /> }));

const base: CoachListingCard = {
  id: "L1", title: "Подача с нуля", description: "Ставим подачу с самого начала.", coachUserId: "C1", coachFullName: "Алексей Морозов",
  coachPhotoUrl: null, sport: "Большой теннис", specialization: "Работа с юниорами", experienceYears: 9, averageRating: 4.8, reviewCount: 6,
  pricePerSession: 3000, currency: "RUB", location: "Москва", offersOnline: true, offersOffline: true, photoFileId: "F1",
  nextAvailableSlot: "2026-12-12T10:00:00Z",
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("a listing card on the coaches tab", () => {
  it("has the coach's name in the header and the facts beside the photo", async () => {
    vi.mocked(listListings).mockResolvedValue([base]);
    render(<CoachMarketplaceScreen token="t" myUserId="me" />);

    const card = (await screen.findByRole("heading", { name: "Подача с нуля" })).closest("button")!;
    const inCard = within(card);
    expect(inCard.getByRole("heading", { name: "Алексей Морозов" })).toBeTruthy();
    expect(inCard.getByText("★ 4.8")).toBeTruthy();
    for (const fact of ["Большой теннис", "Работа с юниорами", "9 лет", "Онлайн · Очно", "Москва", "12 дек., 10:00", "Ставим подачу с самого начала."]) {
      expect(inCard.getByText(fact)).toBeTruthy();
    }
    expect(inCard.getByText("3000 RUB")).toBeTruthy();
    expect(inCard.getByTestId("photo")).toBeTruthy();
  });

  it("keeps the same photo slot for a listing without a photo, and leaves out facts it does not have", async () => {
    vi.mocked(listListings).mockResolvedValue([
      { ...base, photoFileId: null, specialization: null, location: null, nextAvailableSlot: null, averageRating: null, description: null },
    ]);
    const { container } = render(<CoachMarketplaceScreen token="t" myUserId="me" />);

    const card = (await screen.findByRole("heading", { name: "Подача с нуля" })).closest("button")!;
    const inCard = within(card);
    expect(inCard.queryByText("Специализация")).toBeNull();
    expect(inCard.queryByText("Город")).toBeNull();
    expect(inCard.queryByText("Ближайшее время")).toBeNull();
    expect(inCard.queryByTestId("photo")).toBeNull();
    expect(container.querySelector('[class*="listingCardPhotoWrap"]')).toBeTruthy(); // the slot is still there (a placeholder)
  });
});

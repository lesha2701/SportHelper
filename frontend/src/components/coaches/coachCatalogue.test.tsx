import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
vi.mock("../shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => <div /> }));
vi.mock("../shared/AuthenticatedVideo", () => ({ AuthenticatedVideo: () => <div /> }));
vi.mock("./ListingEditScreen", () => ({
  ListingEditScreen: ({ listing, onBack }: { listing: unknown; onBack: () => void }) => (
    <div>
      <p>{listing === null ? "Новое объявление" : "Редактирование"}</p>
      <button onClick={onBack}>Назад</button>
    </div>
  ),
}));

const listing = (id: string, coachUserId: string, title: string): CoachListingCard => ({
  id, title, description: null, coachUserId, coachFullName: `Тренер ${coachUserId}`, coachPhotoUrl: null, sport: "Теннис",
  specialization: null, experienceYears: 3, averageRating: null, reviewCount: 0, pricePerSession: 2000, currency: "RUB",
  location: null, offersOnline: true, offersOffline: false, photoFileId: null, nextAvailableSlot: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listListings).mockResolvedValue([listing("L1", "me", "Моё объявление"), listing("L2", "other", "Чужое объявление")]);
});
afterEach(cleanup);

describe("the coaches tab for a coach", () => {
  it("offers «Создать объявление» and opens the new-listing form right there", async () => {
    render(<CoachMarketplaceScreen token="t" myUserId="me" canCreateListing />);
    await screen.findByText("Чужое объявление");

    fireEvent.click(screen.getByRole("button", { name: "Создать объявление" }));

    expect(screen.getByText("Новое объявление")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(await screen.findByText("Чужое объявление")).toBeTruthy(); // back on the catalogue, reloaded
    expect(listListings).toHaveBeenCalledTimes(2);
  });

  it("does not show the coach's own listings, only other coaches'", async () => {
    render(<CoachMarketplaceScreen token="t" myUserId="me" canCreateListing />);

    await screen.findByText("Чужое объявление");
    expect(screen.queryByText("Моё объявление")).toBeNull();
    expect(screen.getByText("Найдено 1 объявлений")).toBeTruthy();
  });
});

describe("the coaches tab for everyone else", () => {
  it("has no create button for a player or a guest, and shows every listing to a guest", async () => {
    render(<CoachMarketplaceScreen token="t" myUserId="player-1" />);
    await screen.findByText("Моё объявление");
    expect(screen.queryByRole("button", { name: "Создать объявление" })).toBeNull();
    cleanup();

    render(<CoachMarketplaceScreen token="" guest />);
    await waitFor(() => expect(screen.getByText("Моё объявление")).toBeTruthy());
    expect(screen.getByText("Чужое объявление")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Создать объявление" })).toBeNull();
  });
});

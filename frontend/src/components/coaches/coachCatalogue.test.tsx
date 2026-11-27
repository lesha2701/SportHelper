import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listListings, setListingFavorite } from "../../api/coachListings";
import type { CoachListingCard } from "../../types/coachListing";
import { CoachMarketplaceScreen } from "./CoachMarketplaceScreen";

vi.mock("../../api/coachListings", () => ({
  listListings: vi.fn(),
  recordListingView: vi.fn().mockResolvedValue(1),
  setListingFavorite: vi.fn().mockResolvedValue(undefined),
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

  it("opens the form when the button in the page heading is pressed, but not for a press made before it mounted", async () => {
    const { rerender } = render(<CoachMarketplaceScreen token="t" myUserId="me" canCreateListing createListingRequest={3} />);
    await screen.findByText("Чужое объявление");
    expect(screen.queryByText("Новое объявление")).toBeNull();

    rerender(<CoachMarketplaceScreen token="t" myUserId="me" canCreateListing createListingRequest={4} />);

    expect(await screen.findByText("Новое объявление")).toBeTruthy();
  });

  it("shows the coach's own listing too, marked as theirs", async () => {
    render(<CoachMarketplaceScreen token="t" myUserId="me" canCreateListing />);

    await screen.findByText("Чужое объявление");
    expect(screen.getByText("Моё объявление")).toBeTruthy();
    expect(screen.getAllByText("Ваше объявление")).toHaveLength(1);
    expect(screen.getByText("Найдено 2 объявления")).toBeTruthy();
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

  it("lets a player save a listing and filter the catalogue to favorites", async () => {
    render(<CoachMarketplaceScreen token="t" myUserId="player-1" canFavorite />);
    await screen.findByText("Чужое объявление");

    fireEvent.click(screen.getByRole("button", { name: "В избранное: Чужое объявление" }));
    await waitFor(() => expect(setListingFavorite).toHaveBeenCalledWith("t", "L2", true));
    expect(screen.getByRole("button", { name: "Убрать из избранного: Чужое объявление" }).getAttribute("aria-pressed")).toBe("true");

    vi.mocked(listListings).mockResolvedValueOnce([{ ...listing("L2", "other", "Чужое объявление"), isFavorite: true }]);
    fireEvent.click(screen.getByRole("button", { name: /Только избранные/ }));
    await waitFor(() => expect(listListings).toHaveBeenLastCalledWith("t", expect.objectContaining({ favorite_only: true })));
    expect(await screen.findByText("Найдено 1 объявление")).toBeTruthy();
    expect(screen.queryByText("Моё объявление")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Убрать из избранного: Чужое объявление" }));
    await waitFor(() => expect(setListingFavorite).toHaveBeenCalledWith("t", "L2", false));
    expect(await screen.findByText("В избранном пока пусто")).toBeTruthy();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getListingProfile, listListings } from "../../api/coachListings";
import type { CoachListingCard, CoachListingProfile } from "../../types/coachListing";
import { CoachMarketplaceScreen } from "./CoachMarketplaceScreen";

const desktop = vi.hoisted(() => ({ value: false }));
vi.mock("../../hooks/useIsDesktop", () => ({ useIsDesktop: () => desktop.value }));
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
vi.mock("../shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => <div /> }));
vi.mock("../shared/AuthenticatedVideo", () => ({ AuthenticatedVideo: () => <div /> }));

const card = (id: string, coachUserId: string, title: string): CoachListingCard => ({
  id, title, description: null, coachUserId, coachFullName: `Тренер ${coachUserId}`, coachPhotoUrl: null, sport: "Теннис",
  specialization: null, experienceYears: 3, averageRating: null, reviewCount: 0, pricePerSession: 2000, currency: "RUB",
  location: null, offersOnline: true, offersOffline: false, photoFileId: null, nextAvailableSlot: null,
});
const profile = (c: CoachListingCard): CoachListingProfile => ({
  ...c, coachDescription: null, videoFileId: null, sessionDurationMinutes: 60, availability: [], oneOffDates: [], recentReviews: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  desktop.value = false;
  vi.mocked(listListings).mockResolvedValue([card("L1", "me", "Моё"), card("L2", "other", "Чужое")]);
  vi.mocked(getListingProfile).mockImplementation(async (_t, id) => profile(card(id, "other", "Чужое")));
});
afterEach(cleanup);

describe("«Записаться» on the listing card (phone and tablet)", () => {
  it("takes a signed-in person straight to the booking form, and «Назад» returns to the list", async () => {
    render(<CoachMarketplaceScreen token="t" myUserId="me" />);
    await screen.findByText("Чужое");

    fireEvent.click(screen.getByRole("button", { name: "Записаться" })); // only the other coach's listing has one

    expect(await screen.findByText("Запись: Чужое")).toBeTruthy();
    expect(getListingProfile).toHaveBeenCalledWith("t", "L2");
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(await screen.findByText("Чужое")).toBeTruthy(); // the list, not the listing's page
    expect(screen.getByText("Найдено 2 объявления")).toBeTruthy();
  });

  it("is not offered on one's own listing", async () => {
    render(<CoachMarketplaceScreen token="t" myUserId="me" />);
    await screen.findByText("Чужое");

    expect(screen.getAllByRole("button", { name: "Записаться" })).toHaveLength(1);
  });

  it("sends a guest to sign in with the listing in mind instead of opening the form", async () => {
    const onRequireLogin = vi.fn();
    render(<CoachMarketplaceScreen token="" guest onRequireLogin={onRequireLogin} />);
    await screen.findByText("Чужое");

    fireEvent.click(screen.getAllByRole("button", { name: "Записаться" })[1]!);

    expect(onRequireLogin).toHaveBeenCalledWith("L2");
    expect(getListingProfile).not.toHaveBeenCalled();
  });

  it("goes back to the list if the listing can no longer be opened", async () => {
    vi.mocked(getListingProfile).mockRejectedValue(new Error("gone"));
    render(<CoachMarketplaceScreen token="t" myUserId="me" />);
    await screen.findByText("Чужое");

    fireEvent.click(screen.getByRole("button", { name: "Записаться" }));

    await waitFor(() => expect(screen.getByText("Найдено 2 объявления")).toBeTruthy());
  });

  it("is not on the card where the side panel already has its own «Записаться»", async () => {
    desktop.value = true; // wide screen, one card per row: the panel beside the list has the button
    render(<CoachMarketplaceScreen token="t" myUserId="me" />);
    fireEvent.click(await screen.findByText("Чужое")); // selects the other coach's card: the panel shows it

    expect(document.querySelectorAll('[class*="coachCardBook"]')).toHaveLength(0); // none on the cards themselves
    expect(screen.getAllByRole("button", { name: "Записаться" })).toHaveLength(1); // the panel's own
  });
});

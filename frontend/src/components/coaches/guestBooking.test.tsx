import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getListingProfile, listListings } from "../../api/coachListings";
import type { CoachListingCard, CoachListingProfile } from "../../types/coachListing";
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
// Photos are fetched through the files API; irrelevant here.
vi.mock("../shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => <div /> }));
vi.mock("../shared/AuthenticatedVideo", () => ({ AuthenticatedVideo: () => <div /> }));
vi.mock("../profile/AchievementsGallery", () => ({ AchievementsGallery: () => <div /> }));

const card: CoachListingCard = {
  id: "L1",
  title: "Тренировки по теннису",
  description: "О занятиях",
  coachUserId: "C1",
  coachFullName: "Алиса Иванова",
  coachPhotoUrl: null,
  sport: "Теннис",
  specialization: null,
  experienceYears: 7,
  averageRating: null,
  reviewCount: 0,
  pricePerSession: 2500,
  currency: "RUB",
  location: "Москва",
  offersOnline: true,
  offersOffline: true,
  photoFileId: null,
  nextAvailableSlot: null,
};
const profile: CoachListingProfile = {
  ...card,
  coachDescription: null,
  videoFileId: null,
  sessionDurationMinutes: 60,
  availability: [],
  recentReviews: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listListings).mockResolvedValue([card]);
  vi.mocked(getListingProfile).mockResolvedValue(profile);
});
afterEach(cleanup);

describe("booking as a guest", () => {
  it("lets a visitor open a listing, but sends them to sign in when they try to book it", async () => {
    const onRequireLogin = vi.fn();
    render(<CoachMarketplaceScreen token="" guest onRequireLogin={onRequireLogin} initialListingId="L1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Записаться" }));

    expect(onRequireLogin).toHaveBeenCalledWith("L1");
    expect(screen.queryByText(/Запись:/)).toBeNull(); // the booking form never opens for a guest
  });

  it("browsing needs no account at all", async () => {
    render(<CoachMarketplaceScreen token="" guest onRequireLogin={vi.fn()} />);

    expect(await screen.findByText("Тренировки по теннису")).toBeTruthy();
    expect(vi.mocked(listListings)).toHaveBeenCalledTimes(1);
  });

  it("a signed-in user goes straight to the booking form", async () => {
    render(<CoachMarketplaceScreen token="t" initialListingId="L1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Записаться" }));

    expect(await screen.findByText(/Запись: Тренировки по теннису/)).toBeTruthy();
  });
});

describe("returning from sign-in", () => {
  it("opens the booking form of the listing the person wanted", async () => {
    render(<CoachMarketplaceScreen token="t" initialBookListingId="L1" />);

    expect(await screen.findByText(/Запись: Тренировки по теннису/)).toBeTruthy();
    expect(getListingProfile).toHaveBeenCalledWith("t", "L1");
  });

  it("falls back to the listing page if the booking cannot be resumed (e.g. it was unpublished)", async () => {
    vi.mocked(getListingProfile).mockRejectedValueOnce(new Error("gone")).mockResolvedValue(profile);
    render(<CoachMarketplaceScreen token="t" initialBookListingId="L1" />);

    await waitFor(() => expect(screen.queryByText("Открываем запись…")).toBeNull());
    // not a blank screen: the listing page (which loads its own copy) takes over
    expect(await screen.findByRole("button", { name: /Назад/ })).toBeTruthy();
  });
});

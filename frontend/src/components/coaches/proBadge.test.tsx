import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listListings } from "../../api/coachListings";
import type { CoachListingCard, CoachListingProfile } from "../../types/coachListing";
import { BookingFlow } from "./BookingFlow";
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

const card: CoachListingCard = {
  id: "L1", title: "Подача с нуля", description: null, coachUserId: "C1", coachFullName: "Алексей Морозов", coachPhotoUrl: null,
  sport: "Теннис", specialization: null, experienceYears: 9, averageRating: null, reviewCount: 0, pricePerSession: 3000, currency: "RUB",
  location: null, offersOnline: true, offersOffline: false, photoFileId: null, nextAvailableSlot: null,
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("the Pro mark next to a trainer's name", () => {
  it("is shown in the catalogue for a Pro trainer and not for an ordinary one", async () => {
    vi.mocked(listListings).mockResolvedValue([
      { ...card, coachIsPro: true },
      { ...card, id: "L2", title: "Бэкхенд", coachUserId: "C2", coachFullName: "Борис Орлов", coachIsPro: false },
    ]);
    render(<CoachMarketplaceScreen token="t" myUserId="me" />);

    const pro = (await screen.findByRole("heading", { name: "Подача с нуля" })).closest("button")!;
    expect(within(pro).getByTitle("Тренер Pro").textContent).toContain("PRO");
    const ordinary = screen.getByRole("heading", { name: "Бэкхенд" }).closest("button")!;
    expect(within(ordinary).queryByTitle("Тренер Pro")).toBeNull();
  });

  it("is shown while booking, under the title and in the summary", async () => {
    const listing = { id: "L1", title: "Теннис", coachFullName: "Алиса", coachIsPro: true, offersOnline: true, offersOffline: false, pricePerSession: 2500, currency: "RUB", location: null } as unknown as CoachListingProfile;
    render(<BookingFlow token="t" listing={listing} onBack={() => {}} onBooked={() => {}} />);
    expect(screen.getAllByTitle("Тренер Pro").length).toBeGreaterThanOrEqual(1);
  });

  it("is not shown while booking an ordinary trainer", () => {
    const listing = { id: "L1", title: "Теннис", coachFullName: "Алиса", offersOnline: true, offersOffline: false, pricePerSession: 2500, currency: "RUB", location: null } as unknown as CoachListingProfile;
    render(<BookingFlow token="t" listing={listing} onBack={() => {}} onBooked={() => {}} />);
    expect(screen.queryByTitle("Тренер Pro")).toBeNull();
  });
});

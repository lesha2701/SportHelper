import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api/coachListings";
import type { CoachListing } from "../../types/coachListing";
import { todayIso } from "./oneOffDates";
import { ListingEditScreen } from "./ListingEditScreen";

vi.mock("../../api/coachListings", () => ({
  createListing: vi.fn(),
  updateListing: vi.fn(),
  getListingAvailability: vi.fn(),
  replaceListingAvailability: vi.fn(),
  getListingDates: vi.fn(),
  addListingDate: vi.fn(),
  deleteListingDate: vi.fn(),
  uploadListingPhoto: vi.fn(),
  uploadListingVideo: vi.fn(),
}));
vi.mock("../shared/AuthenticatedImage", () => ({ AuthenticatedImage: () => <div /> }));
vi.mock("../shared/AuthenticatedVideo", () => ({ AuthenticatedVideo: () => <div /> }));

const listing = {
  id: "L1", title: "Теннис", description: null, isListed: false, pricePerSession: 2000, currency: "RUB", offersOnline: true,
  offersOffline: false, location: null, sessionDurationMinutes: 60, photoFileId: null, videoFileId: null,
} as unknown as CoachListing;

const tomorrow = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return todayIso(d);
})();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getListingAvailability).mockResolvedValue([]);
  vi.mocked(api.getListingDates).mockResolvedValue([
    { id: "D1", slotDate: tomorrow, startTime: "09:00:00", endTime: "10:00:00" },
  ]);
  vi.mocked(api.addListingDate).mockImplementation(async (_t, _l, d) => ({ id: "D2", slotDate: d.slot_date, startTime: d.start_time, endTime: d.end_time }));
  vi.mocked(api.deleteListingDate).mockResolvedValue(undefined);
  vi.mocked(api.updateListing).mockResolvedValue(listing);
});
afterEach(cleanup);

const fillNewDate = (day: string) => {
  fireEvent.change(screen.getByLabelText("Дата"), { target: { value: day } });
  fireEvent.click(screen.getByRole("button", { name: "Добавить дату" }));
};

describe("one-off dates in the listing editor", () => {
  it("shows the saved dates, and on Save adds the new one and deletes the removed one", async () => {
    render(<ListingEditScreen token="t" listing={listing} onBack={() => {}} />);
    expect(await screen.findByText(/09:00 — 10:00/)).toBeTruthy();

    fillNewDate(tomorrow);
    expect(screen.getByText("ещё не сохранена")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить дату" })[0]!); // the saved one (09:00) is listed first
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.deleteListingDate).toHaveBeenCalledWith("t", "L1", "D1"));
    expect(api.addListingDate).toHaveBeenCalledTimes(1);
    expect(api.addListingDate).toHaveBeenCalledWith("t", "L1", { slot_date: tomorrow, start_time: "10:00:00", end_time: "12:00:00" });
  });

  it("refuses a date in the past before sending anything", async () => {
    render(<ListingEditScreen token="t" listing={listing} onBack={() => {}} />);
    await screen.findByText(/09:00 — 10:00/);

    fillNewDate("2020-01-01");

    expect(screen.queryByText("ещё не сохранена")).toBeNull();
    expect(api.addListingDate).not.toHaveBeenCalled();
  });

  it("saves a date picked in the template even if «Добавить дату» was not pressed", async () => {
    vi.mocked(api.getListingDates).mockResolvedValue([]);
    render(<ListingEditScreen token="t" listing={listing} onBack={() => {}} />);
    await screen.findByLabelText("Дата"); // the dates section shows only after the dates have loaded, not as soon as they are requested

    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: tomorrow } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.addListingDate).toHaveBeenCalledTimes(1));
    expect(api.addListingDate).toHaveBeenCalledWith("t", "L1", { slot_date: tomorrow, start_time: "10:00:00", end_time: "12:00:00" });
  });

  it("an empty template (no date chosen) adds nothing on Save", async () => {
    vi.mocked(api.getListingDates).mockResolvedValue([]);
    render(<ListingEditScreen token="t" listing={listing} onBack={() => {}} />);
    await screen.findByLabelText("Дата"); // the dates section shows only after the dates have loaded, not as soon as they are requested

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.updateListing).toHaveBeenCalled());
    expect(api.addListingDate).not.toHaveBeenCalled();
  });

  it("a date in the template that is in the past stops the save with a message", async () => {
    vi.mocked(api.getListingDates).mockResolvedValue([]);
    render(<ListingEditScreen token="t" listing={listing} onBack={() => {}} />);
    await screen.findByLabelText("Дата"); // the dates section shows only after the dates have loaded, not as soon as they are requested

    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: "2020-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(await screen.findByText(/уже прошла/)).toBeTruthy();
    expect(api.addListingDate).not.toHaveBeenCalled();
    expect(api.updateListing).not.toHaveBeenCalled();
  });

  it("lets a listing be published with a date alone, no weekly window", async () => {
    vi.mocked(api.getListingDates).mockResolvedValue([]);
    render(<ListingEditScreen token="t" listing={{ ...listing, isListed: true }} onBack={() => {}} />);
    await screen.findByLabelText("Дата"); // the dates section shows only after the dates have loaded, not as soon as they are requested
    fillNewDate(tomorrow);
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(api.updateListing).toHaveBeenCalled());
    expect(api.addListingDate).toHaveBeenCalledTimes(1);
    // the date is written before the publish call, so the server finds a schedule
    expect(vi.mocked(api.addListingDate).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.updateListing).mock.invocationCallOrder[0]!);
  });
});

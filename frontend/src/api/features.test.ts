import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFeatures, resetFeaturesCache } from "./features";

const apiRequest = vi.hoisted(() => vi.fn());
vi.mock("./client", () => ({ apiRequest }));

beforeEach(() => {
  apiRequest.mockReset();
  resetFeaturesCache();
});

describe("getFeatures", () => {
  it("reads the server's answer once per page load", async () => {
    apiRequest.mockResolvedValue({ telegram: true, payments: true });

    expect(await getFeatures()).toEqual({ telegram: true, payments: true });
    expect(await getFeatures()).toEqual({ telegram: true, payments: true });
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith("/api/features", { silent: true });
  });

  it("keeps everything optional off when the server cannot be reached", async () => {
    apiRequest.mockImplementation(() => Promise.reject(new Error("offline")));

    expect(await getFeatures()).toEqual({ telegram: false, payments: false });
  });

  it("treats anything but an explicit true as off", async () => {
    apiRequest.mockResolvedValue({});

    expect(await getFeatures()).toEqual({ telegram: false, payments: false });
  });
});

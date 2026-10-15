import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFeatures } from "./api/features";
import { useTelegramEnabled } from "./features";

vi.mock("./api/features");
const features = vi.mocked(getFeatures);

function Probe() {
  return <span>{useTelegramEnabled() ? "on" : "off"}</span>;
}

beforeEach(() => features.mockReset());
afterEach(cleanup);

describe("the Telegram switch", () => {
  it("follows what the server says, and is off until it has answered", async () => {
    features.mockResolvedValue({ telegram: true });
    render(<Probe />);

    expect(screen.getByText("off")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("on")).toBeTruthy());
  });

  it("stays off when the server says it is off", async () => {
    features.mockResolvedValue({ telegram: false });
    render(<Probe />);

    await waitFor(() => expect(features).toHaveBeenCalled());
    expect(screen.getByText("off")).toBeTruthy();
  });
});

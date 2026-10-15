import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendActivityPing } from "../api/activity";
import { ACTIVITY_PING_INTERVAL_MS, useActivityPing } from "./useActivityPing";

vi.mock("../api/activity", () => ({ sendActivityPing: vi.fn(() => Promise.resolve()) }));
const ping = vi.mocked(sendActivityPing);

function Probe({ enabled = true }: { enabled?: boolean }) {
  useActivityPing(enabled);
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

const minutes = (n: number) => act(async () => void vi.advanceTimersByTime(n * 60_000));
const interact = () => window.dispatchEvent(new Event("pointerdown"));

beforeEach(() => {
  vi.useFakeTimers();
  ping.mockClear();
  setVisibility("visible");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("activity heartbeat", () => {
  it("reports once when the signed-in app opens in a visible tab", () => {
    render(<Probe />);

    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("does not report from a tab nobody can see", () => {
    setVisibility("hidden");
    render(<Probe />);

    expect(ping).not.toHaveBeenCalled();
  });

  it("does nothing for a signed-out visitor", async () => {
    render(<Probe enabled={false} />);
    await minutes(30);

    expect(ping).not.toHaveBeenCalled();
  });

  it("an idle tab left open stops counting: no input, no further reports", async () => {
    render(<Probe />);
    await minutes(120);

    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("keeps reporting - but only every few minutes - while the person interacts", async () => {
    render(<Probe />);
    await minutes(2);
    interact();
    await minutes(1); // 3 minutes since the first report: too soon
    expect(ping).toHaveBeenCalledTimes(1);

    await minutes(3); // past the interval, and there was input
    expect(ping).toHaveBeenCalledTimes(2);

    await minutes(30); // no input since: nothing more
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("many clicks do not mean many requests", async () => {
    render(<Probe />);
    for (let i = 0; i < 50; i++) interact();
    await minutes(1);

    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("reports again when the person comes back to the tab after a while", async () => {
    render(<Probe />);
    setVisibility("hidden");
    await minutes(10);
    setVisibility("visible");
    act(() => void document.dispatchEvent(new Event("visibilitychange")));

    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("returning to the tab straight away does not report twice", () => {
    render(<Probe />);
    act(() => void document.dispatchEvent(new Event("visibilitychange")));

    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("stops listening when the app closes", async () => {
    const { unmount } = render(<Probe />);
    unmount();
    interact();
    await minutes(ACTIVITY_PING_INTERVAL_MS / 60_000 + 1);

    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("a failed report never breaks the page", async () => {
    ping.mockRejectedValueOnce(new Error("offline"));

    expect(() => render(<Probe />)).not.toThrow();
    await act(async () => {});
  });
});

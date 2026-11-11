import { afterEach, describe, expect, it, vi } from "vitest";
import { localDateKey } from "./localDate";
import { isTrainingOverdue } from "../types/training";

afterEach(() => vi.useRealTimers());

describe("localDateKey", () => {
  it("is the device's calendar day, not the UTC one", () => {
    const justAfterMidnight = new Date(2026, 10, 17, 0, 30); // 17 Nov, 00:30 on the device
    expect(localDateKey(justAfterMidnight)).toBe("2026-11-17");
  });
});

describe("isTrainingOverdue", () => {
  it("does not call today's training overdue just after midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 17, 0, 30));
    expect(isTrainingOverdue({ status: "scheduled", trainingDate: "2026-11-17" })).toBe(false);
    expect(isTrainingOverdue({ status: "scheduled", trainingDate: "2026-11-16" })).toBe(true);
  });
});

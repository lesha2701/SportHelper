import { describe, expect, it } from "@jest/globals";
import { cancelledBy, previewText, refundLine } from "./cancelText";
import type { CancelPreview, Cancellation } from "../types/booking";

const preview = (extra: Partial<CancelPreview>): CancelPreview => ({
  policy: "athlete_early", hoursBeforeStart: 52, freeCancelUntil: "2026-11-20T09:00:00Z", paidKopecks: 500000,
  refundPercent: 100, refundKopecks: 500000, trainerKeepsPayment: false, ...extra,
});

const cancellation = (extra: Partial<Cancellation>): Cancellation => ({
  cancelledByRole: "athlete", cancelledAt: "2026-11-12T08:00:00Z", reason: null, policy: "athlete_early",
  refundPercent: 100, refundAmountKopecks: 500000, refundStatus: "pending", ...extra,
});

describe("what the person is told before cancelling", () => {
  it("says the money comes back when the player cancels in time", () => {
    const text = previewText(preview({}), "athlete");
    expect(text).toContain("Вернём 100%");
    expect(text).toContain("5\u00a0000,00");
    expect(text).toContain("Бесплатная отмена возможна до");
  });

  it("says the money does not come back when it is too late", () => {
    const text = previewText(preview({ policy: "athlete_late", refundPercent: 0, refundKopecks: 0, trainerKeepsPayment: true }), "athlete");
    expect(text).toContain("Деньги не вернутся");
  });

  it("says nothing was charged for an unpaid booking", () => {
    expect(previewText(preview({ policy: "unpaid", refundPercent: 0, refundKopecks: 0 }), "athlete")).toContain("отмена бесплатна");
  });

  it("tells a coach that the player gets everything back and their earning is removed", () => {
    const text = previewText(preview({ policy: "coach" }), "coach");
    expect(text).toContain("Игрок получит полный возврат");
    expect(text).toContain("начисление");
  });

  it("does not guess about a rule it does not know", () => {
    expect(previewText(preview({ policy: "something_new" as never }), "athlete")).toContain("Запись будет отменена");
  });
});

describe("the money line of a cancelled booking", () => {
  it("follows the refund status from each side", () => {
    expect(refundLine(cancellation({ refundStatus: "pending" }), "athlete")).toContain("обрабатывается");
    expect(refundLine(cancellation({ refundStatus: "succeeded" }), "athlete")).toContain("Возвращено");
    expect(refundLine(cancellation({ refundStatus: "succeeded" }), "coach")).toContain("Игроку возвращено");
    expect(refundLine(cancellation({ refundStatus: "failed" }), "athlete")).toContain("Банк не принял возврат");
  });

  it("says nothing when there is nothing to return", () => {
    expect(refundLine(cancellation({ policy: "unpaid", refundStatus: "none", refundAmountKopecks: 0 }), "athlete")).toBeNull();
  });

  it("explains a late cancellation to both sides", () => {
    const late = cancellation({ policy: "athlete_late", refundStatus: "none", refundAmountKopecks: 0 });
    expect(refundLine(late, "athlete")).toContain("Деньги не возвращены");
    expect(refundLine(late, "coach")).toContain("оплата осталась у вас");
  });
});

describe("who cancelled", () => {
  it("names the reader, the coach or the player", () => {
    expect(cancelledBy(cancellation({ cancelledByRole: "athlete" }), "athlete")).toMatch(/^Отменена вами · /);
    expect(cancelledBy(cancellation({ cancelledByRole: "coach" }), "athlete")).toMatch(/^Отменена тренером · /);
    expect(cancelledBy(cancellation({ cancelledByRole: "athlete" }), "coach")).toMatch(/^Отменена игроком · /);
  });
});

import { describe, expect, it } from "@jest/globals";
import { PROBLEMS_OF, PROBLEM_LABELS, confirmationLine, formatCode } from "./sessionText";
import type { SessionConfirmation } from "../types/booking";

const confirmation = (extra: Partial<SessionConfirmation>): SessionConfirmation => ({
  state: "awaiting", windowClosesAt: "2026-11-13T11:00:00Z", coachMarkedAt: null, confirmedAt: null, confirmedMethod: null,
  disputedByRole: null, disputeKind: null, disputeText: null, resolvedAt: null,
  canConfirm: false, canReportProblem: false, canGetCode: false, canEnterCode: false, ...extra,
});

describe("the line about whether the session took place", () => {
  it("says nothing before the session is over", () => {
    expect(confirmationLine(confirmation({ state: "scheduled" }), "athlete")).toBeNull();
  });

  it("asks the player to confirm and tells the coach to wait, both with the time of the automatic confirmation", () => {
    expect(confirmationLine(confirmation({}), "athlete")).toContain("Подтвердите её или сообщите о проблеме");
    expect(confirmationLine(confirmation({}), "athlete")).toContain("подтвердится автоматически");
    expect(confirmationLine(confirmation({}), "coach")).toContain("Ждём подтверждения игрока");
  });

  it("names how a session was confirmed, from each side", () => {
    expect(confirmationLine(confirmation({ state: "confirmed", confirmedMethod: "athlete" }), "athlete")).toBe("Вы подтвердили тренировку.");
    expect(confirmationLine(confirmation({ state: "confirmed", confirmedMethod: "athlete" }), "coach")).toBe("Игрок подтвердил тренировку.");
    expect(confirmationLine(confirmation({ state: "confirmed", confirmedMethod: "code" }), "coach")).toBe("Тренировка подтверждена кодом игрока.");
    expect(confirmationLine(confirmation({ state: "auto_confirmed", confirmedMethod: "auto" }), "athlete")).toBe("Тренировка подтверждена автоматически.");
  });

  it("tells who reported a problem and what happens to the money", () => {
    const own = confirmation({ state: "disputed", disputedByRole: "athlete", disputeKind: "coach_no_show" });
    expect(confirmationLine(own, "athlete")).toBe("Вы сообщили: тренер не пришёл. Решение примет администратор.");
    expect(confirmationLine(own, "coach")).toContain("Оплата заморожена");
    const other = confirmation({ state: "disputed", disputedByRole: "coach", disputeKind: "athlete_no_show" });
    expect(confirmationLine(other, "athlete")).toContain("Тренер сообщил: игрок не пришёл");
  });

  it("tells how a dispute ended", () => {
    expect(confirmationLine(confirmation({ state: "resolved_released" }), "athlete")).toContain("оплата осталась у тренера");
    expect(confirmationLine(confirmation({ state: "resolved_refunded" }), "athlete")).toContain("деньги возвращаются вам");
    expect(confirmationLine(confirmation({ state: "resolved_refunded" }), "coach")).toContain("деньги возвращены игроку");
  });

  it("never breaks on a state this version does not know", () => {
    expect(confirmationLine(confirmation({ state: "something_new" as never }), "athlete")).toBe("Ожидает подтверждения.");
  });
});

describe("what each side may report", () => {
  it("is the same list the server accepts", () => {
    expect(PROBLEMS_OF.athlete).toEqual(["coach_no_show", "not_conducted", "other"]);
    expect(PROBLEMS_OF.coach).toEqual(["athlete_no_show", "other"]);
    expect(PROBLEM_LABELS.other).toBe("Другое");
  });
});

describe("the one-time code", () => {
  it("is read in two groups of three", () => {
    expect(formatCode("482913")).toBe("482 913");
    expect(formatCode("123")).toBe("123");
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { loadView, saveView } from "./viewState";

const COACH = ["dashboard", "teams", "library"] as const;
const PLAYER = ["dashboard", "teams", "calendar"] as const;

afterEach(() => window.sessionStorage.clear());

describe("the remembered screen", () => {
  it("brings back the tab and the open card after a reload", () => {
    saveView("u1", { coachTab: "library", playerTab: "calendar", overlay: { kind: "team", teamId: "t1" } });

    expect(loadView("u1", COACH, PLAYER)).toEqual({ coachTab: "library", playerTab: "calendar", overlay: { kind: "team", teamId: "t1" } });
  });

  it("keeps each person's screen apart", () => {
    saveView("u1", { playerTab: "teams" });

    expect(loadView("u2", COACH, PLAYER)).toEqual({});
  });

  it("ignores a tab that no longer exists and text that is not ours", () => {
    window.sessionStorage.setItem("sag-view:u1", JSON.stringify({ coachTab: "gone", playerTab: "teams" }));
    expect(loadView("u1", COACH, PLAYER)).toEqual({ playerTab: "teams" });

    window.sessionStorage.setItem("sag-view:u1", "not json");
    expect(loadView("u1", COACH, PLAYER)).toEqual({});
  });

  it("does not bring back an edit form, which holds a whole training", () => {
    saveView("u1", { playerTab: "calendar", overlay: { kind: "training-edit", training: {} as never } });

    expect(loadView("u1", COACH, PLAYER)).toEqual({ playerTab: "calendar" });
  });
});

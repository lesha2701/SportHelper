import { describe, expect, it } from "@jest/globals";
import { routeForPushData } from "./pushData";

describe("where a tapped push leads", () => {
  it("opens what the notification is about", () => {
    expect(routeForPushData({ category: "new_training", entity_type: "training", entity_id: "t1" })).toEqual({ pathname: "/training/[id]", params: { id: "t1" } });
    expect(routeForPushData({ category: "booking_decided", entity_type: "booking", entity_id: "b1" })).toEqual({ pathname: "/bookings" });
  });

  it("opens the chat for a chat message, not the booking or the team", () => {
    expect(routeForPushData({ category: "chat_team", entity_type: "team", entity_id: "g1" })).toEqual({ pathname: "/chat/[kind]/[id]", params: { kind: "team", id: "g1" } });
  });

  it("never breaks on a push it does not understand", () => {
    expect(routeForPushData(undefined)).toBeNull();
    expect(routeForPushData("text")).toBeNull();
    expect(routeForPushData({ entity_type: "training" })).toBeNull();
    expect(routeForPushData({ entity_type: "something_new", entity_id: "x" })).toBeNull();
  });
});

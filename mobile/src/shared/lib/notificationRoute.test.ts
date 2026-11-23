import { describe, expect, it } from "@jest/globals";
import { routeForNotification } from "./notificationRoute";

describe("routeForNotification", () => {
  it("opens the thing the notification is about", () => {
    expect(routeForNotification("training", "t1")).toEqual({ pathname: "/training/[id]", params: { id: "t1" } });
    expect(routeForNotification("task", "k1")).toEqual({ pathname: "/task/[id]", params: { id: "k1" } });
    expect(routeForNotification("match", "m1")).toEqual({ pathname: "/match/[id]", params: { id: "m1" } });
  });

  it("opens blog and matching destinations from the shared notification router", () => {
    expect(routeForNotification("post", "p1", "post_comment")).toEqual({ pathname: "/blog/[id]", params: { id: "p1" } });
    expect(routeForNotification("match_request", "r1", "match_offer_reply")).toEqual({ pathname: "/match-requests", params: { id: "r1" } });
    expect(routeForNotification("match_offer", "o1", "match_offer")).toEqual({ pathname: "/match-offers", params: { id: "o1" } });
  });

  it("sends money and booking news to their lists, and leaves the rest as text", () => {
    expect(routeForNotification("booking", "b")).toEqual({ pathname: "/bookings" });
    expect(routeForNotification("payment", "p")).toEqual({ pathname: "/bookings" });
    expect(routeForNotification("withdrawal", "w")).toEqual({ pathname: "/finance" });
    expect(routeForNotification("user", "u")).toBeNull();
  });

  it("opens the chat for chat messages, whatever the entity type", () => {
    expect(routeForNotification("booking", "b1", "chat_booking")).toEqual({ pathname: "/chat/[kind]/[id]", params: { kind: "booking", id: "b1" } });
    expect(routeForNotification("team", "t1", "chat_team")).toEqual({ pathname: "/chat/[kind]/[id]", params: { kind: "team", id: "t1" } });
  });
});

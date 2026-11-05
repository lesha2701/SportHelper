import { describe, expect, it } from "@jest/globals";
import { routeForNotification } from "./notificationRoute";

describe("routeForNotification", () => {
  it("opens the thing the notification is about", () => {
    expect(routeForNotification("training", "t1")).toEqual({ pathname: "/training/[id]", params: { id: "t1" } });
    expect(routeForNotification("task", "k1")).toEqual({ pathname: "/task/[id]", params: { id: "k1" } });
    expect(routeForNotification("match", "m1")).toEqual({ pathname: "/match/[id]", params: { id: "m1" } });
  });

  it("sends money and booking news to their lists, and leaves the rest as text", () => {
    expect(routeForNotification("booking", "b")).toEqual({ pathname: "/bookings" });
    expect(routeForNotification("payment", "p")).toEqual({ pathname: "/bookings" });
    expect(routeForNotification("withdrawal", "w")).toEqual({ pathname: "/finance" });
    expect(routeForNotification("user", "u")).toBeNull();
  });
});

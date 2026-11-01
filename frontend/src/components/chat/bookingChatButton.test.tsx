import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bookingHasChat } from "../../types/chat";
import { BookingChatButton } from "./BookingChatButton";

afterEach(cleanup);

describe("who gets a chat button", () => {
  it.each([
    ["confirmed", "paid", true],
    ["confirmed", "refund_pending", true],
    ["confirmed", "not_required", true], // a free lesson
    ["confirmed", "unpaid", false], // not paid yet
    ["confirmed", "processing", false],
    ["confirmed", "canceled", false],
    ["confirmed", "refunded", false],
    ["pending", "unpaid", false], // the coach has not answered
    ["declined", "paid", false],
    ["cancelled", "paid", false],
  ])("a %s booking with payment %s -> %s", (status, paymentStatus, expected) => {
    expect(bookingHasChat({ status, paymentStatus })).toBe(expected);
  });
});

describe("the button", () => {
  it("opens the chat without also opening the card it sits on", () => {
    const open = vi.fn();
    const card = vi.fn();
    render(
      <div onClick={card}>
        <BookingChatButton booking={{ status: "confirmed", paymentStatus: "paid" }} label="Чат с тренером" unread={0} onOpen={open} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Чат с тренером/ }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(card).not.toHaveBeenCalled();
  });

  it("shows how many messages are unread", () => {
    render(<BookingChatButton booking={{ status: "confirmed", paymentStatus: "paid" }} label="Чат с игроком" unread={3} onOpen={() => {}} />);
    expect(screen.getByLabelText("Непрочитанных: 3")).toBeTruthy();
  });

  it("is absent before the lesson is paid", () => {
    render(<BookingChatButton booking={{ status: "confirmed", paymentStatus: "unpaid" }} label="Чат с тренером" unread={0} onOpen={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

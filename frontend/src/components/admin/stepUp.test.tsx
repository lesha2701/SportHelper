import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyMfa } from "../../api/auth";
import { ApiError } from "../../api/client";
import { StepUpCancelled, StepUpProvider, useStepUp } from "./stepUp";

vi.mock("../../api/auth", () => ({ verifyMfa: vi.fn() }));
const verifyMock = vi.mocked(verifyMfa);

let outcome: Promise<unknown> | null = null;
function Probe({ action }: { action: () => Promise<string> }) {
  const stepUp = useStepUp();
  return (
    <button
      type="button"
      onClick={() => {
        outcome = stepUp.run(action).catch((e: unknown) => e);
      }}
    >
      go
    </button>
  );
}

const flush = () => act(async () => {});
const staleCode = () => new ApiError(403, "mfa_recent_required", "confirm your two-factor code again to do this");

beforeEach(() => {
  verifyMock.mockReset();
  outcome = null;
});
afterEach(cleanup);

function setup(action: () => Promise<string>) {
  render(
    <StepUpProvider>
      <Probe action={action} />
    </StepUpProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "go" }));
}

describe("step-up confirmation for irreversible actions", () => {
  it("does not interrupt an action the server accepts", async () => {
    const action = vi.fn().mockResolvedValue("done");
    setup(action);
    await flush();

    expect(await outcome).toBe("done");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("asks for a fresh code when the server says the last one is too old, then retries once", async () => {
    const action = vi.fn().mockRejectedValueOnce(staleCode()).mockResolvedValueOnce("done");
    verifyMock.mockResolvedValue();
    setup(action);
    await flush();

    fireEvent.change(screen.getByLabelText("Код из приложения"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    await flush();

    expect(verifyMock).toHaveBeenCalledWith("123456");
    expect(await outcome).toBe("done");
    expect(action).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps asking when the code is wrong, and does not retry the action", async () => {
    const action = vi.fn().mockRejectedValueOnce(staleCode());
    verifyMock.mockRejectedValue(new ApiError(400, "invalid_code", "Неверный код."));
    setup(action);
    await flush();

    fireEvent.change(screen.getByLabelText("Код из приложения"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
    await flush();

    expect(screen.getByText("Неверный код.")).toBeTruthy();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("closing the prompt abandons the action", async () => {
    const action = vi.fn().mockRejectedValue(staleCode());
    setup(action);
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    await flush();

    expect(await outcome).toBeInstanceOf(StepUpCancelled);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("passes every other error straight through", async () => {
    const failure = new ApiError(409, "file_shared", "нельзя");
    setup(vi.fn().mockRejectedValue(failure));
    await flush();

    expect(await outcome).toBe(failure);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

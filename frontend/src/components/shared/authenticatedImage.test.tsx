import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFileBlob } from "../../api/files";
import { AuthenticatedImage } from "./AuthenticatedImage";

vi.mock("../../api/files", () => ({ fetchFileBlob: vi.fn() }));
const fetchMock = vi.mocked(fetchFileBlob);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Blob(["x"], { type: "image/webp" }));
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("AuthenticatedImage", () => {
  it("loads the full picture by default - WebP included", async () => {
    render(<AuthenticatedImage token="t" fileId="f1" alt="Фото" />);
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith("t", "f1", undefined);
    expect(screen.getByAltText("Фото").getAttribute("src")).toBe("blob:test");
  });

  it("asks for the small copy in lists and cards", async () => {
    render(<AuthenticatedImage token="t" fileId="f2" alt="Карточка" thumb />);
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledWith("t", "f2", "thumb");
    expect(screen.getByAltText("Карточка")).not.toBeNull();
  });
});

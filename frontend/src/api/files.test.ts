import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchFileBlob } from "./files";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(ok = true) {
  const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok, status: ok ? 200 : 404, blob: async () => new Blob(["x"]) }) as unknown as Response);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

describe("fetchFileBlob", () => {
  it("requests the file itself unless a size is given - old URLs are unchanged", async () => {
    const spy = stubFetch();
    await fetchFileBlob("t", "abc");

    expect(String(spy.mock.calls[0]?.[0])).toMatch(/\/api\/files\/abc$/);
  });

  it("requests the thumbnail with ?size=thumb", async () => {
    const spy = stubFetch();
    await fetchFileBlob("t", "abc", "thumb");

    expect(String(spy.mock.calls[0]?.[0])).toMatch(/\/api\/files\/abc\?size=thumb$/);
  });

  it("reports a missing file in Russian", async () => {
    stubFetch(false);

    await expect(fetchFileBlob("t", "abc")).rejects.toMatchObject({ code: "download_error", message: "Не удалось загрузить файл" });
  });
});

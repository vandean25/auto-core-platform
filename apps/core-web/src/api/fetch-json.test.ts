// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithAuth } from "./api-error";

vi.mock("@/lib/firebase", () => ({ firebaseAuth: null }));
vi.mock("@/lib/runtime-flags", () => ({
  isE2ETestTokenAuthEnabled: () => false,
  getE2ETestToken: () => null,
}));

afterEach(() => vi.unstubAllGlobals());

describe("fetchJsonWithAuth", () => {
  it("returns success JSON and forwards request options", async () => {
    const payload = { id: "created-record" };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(payload));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchJsonWithAuth("/api/bays", "Create failed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bay 1" }),
    });

    expect(result).toEqual(payload);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/bays");
    expect(options.method).toBe("POST");
    expect(options.body).toBe(JSON.stringify({ name: "Bay 1" }));
    expect(options.headers.get("Content-Type")).toBe("application/json");
  });

  it("preserves the backend error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { message: "Original backend message" },
            { status: 409 },
          ),
        ),
    );

    await expect(fetchJsonWithAuth("/api/bays", "Fallback")).rejects.toThrow(
      "Original backend message",
    );
  });

  it.each([{}, { message: "" }, null])(
    "uses the fallback for %j",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(Response.json(body, { status: 500 })),
      );

      await expect(
        fetchJsonWithAuth("/api/bays", "Original fallback"),
      ).rejects.toThrow("Original fallback");
    },
  );

  it("uses the fallback when the error response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("upstream unavailable", { status: 502 }),
        ),
    );

    await expect(
      fetchJsonWithAuth("/api/bays", "Original fallback"),
    ).rejects.toThrow("Original fallback");
  });

  it("preserves success-body parsing failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON")));

    await expect(
      fetchJsonWithAuth("/api/bays", "Fallback"),
    ).rejects.toBeInstanceOf(SyntaxError);
  });
});

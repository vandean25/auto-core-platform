import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithAuth } from "./client";
import {
  WARRANTY_CLAIM_PDF_TIMEOUT_MS,
  WARRANTY_CLAIM_SAVE_TIMEOUT_MS,
  createWarrantyClaim,
  downloadWarrantyClaimPdf,
  fetchWarrantyClaims,
  updateWarrantyClaim,
  useCreateWarrantyClaim,
  useUpdateWarrantyClaim,
  useWarrantyClaim,
  useWarrantyClaims,
  warrantyClaimKeys,
} from "./warranty-claims";
import type { WarrantyClaim } from "./types";

vi.mock("./client", () => ({
  fetchWithAuth: vi.fn(),
}));

const fetchMock = vi.mocked(fetchWithAuth);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function claimFixture(overrides: Partial<WarrantyClaim> = {}): WarrantyClaim {
  return {
    id: "claim-1",
    workshopOrderId: "order-1",
    type: "GARANTIE",
    status: "DRAFT",
    complaint: null,
    causeCorrection: null,
    claimedAmountNet: null,
    linesNetAmount: "0.00",
    externalReference: null,
    decisionDate: null,
    decisionNote: null,
    submittedAt: null,
    closedAt: null,
    createdAt: "2026-10-10T08:00:00.000Z",
    updatedAt: "2026-10-10T08:00:00.000Z",
    lines: [],
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("warranty claim API", () => {
  it("lists the claims of one order, with the status filter when one is given", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ data: [], meta: { total: 0 } }));

    await fetchWarrantyClaims("order-1", "SUBMITTED_EXTERNALLY");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/workshop/orders/order-1/warranty-claims?status=SUBMITTED_EXTERNALLY",
    );

    await fetchWarrantyClaims("order-1");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/workshop/orders/order-1/warranty-claims");
  });

  it("shows the message the API returns when a request is refused", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: "Garantie/Kulanz claims are restricted to owners, admins and workshop advisors." }, 403),
    );

    await expect(fetchWarrantyClaims("order-1")).rejects.toThrow(
      "Garantie/Kulanz claims are restricted to owners, admins and workshop advisors.",
    );
  });

  it("joins validation messages from the API", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: ["type must be a valid enum value", "complaint is too long"] }, 400),
    );

    await expect(fetchWarrantyClaims("order-1")).rejects.toThrow(
      "type must be a valid enum value complaint is too long",
    );
  });

  it("creates a claim and seeds its detail cache", async () => {
    const created = claimFixture({ id: "claim-new" });
    fetchMock.mockResolvedValue(jsonResponse(created, 201));
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useCreateWarrantyClaim(), {
      wrapper: createWrapper(queryClient),
    });
    await result.current.mutateAsync({ orderId: "order-1", payload: { type: "GARANTIE" } });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/workshop/orders/order-1/warranty-claims",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ type: "GARANTIE" }) }),
    );
    expect(queryClient.getQueryData(warrantyClaimKeys.detail("order-1", "claim-new"))).toEqual(created);
  });

  it("gives up on a create that does not answer, and says it may have been created", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));

      const outcome = createWarrantyClaim("order-1", { type: "GARANTIE" }).catch(
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(WARRANTY_CLAIM_SAVE_TIMEOUT_MS);

      const error = await outcome;
      expect((error as DOMException).name).toBe("TimeoutError");
      expect((error as DOMException).message).toMatch(/may still have been created/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the list again after a create fails, because the server may have applied it", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Refused" }, 500));
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateWarrantyClaim(), {
      wrapper: createWrapper(queryClient),
    });
    await expect(
      result.current.mutateAsync({ orderId: "order-1", payload: { type: "GARANTIE" } }),
    ).rejects.toThrow();

    expect(invalidate).toHaveBeenCalledWith({ queryKey: warrantyClaimKeys.lists("order-1") });
  });

  it("shows the new draft in the cached list at once, so it can be selected", async () => {
    const created = claimFixture({ id: "claim-new", status: "DRAFT" });
    fetchMock.mockResolvedValue(jsonResponse(created, 201));
    const queryClient = createQueryClient();
    queryClient.setQueryData(warrantyClaimKeys.list("order-1"), { data: [], meta: { total: 0 } });

    const { result } = renderHook(() => useCreateWarrantyClaim(), {
      wrapper: createWrapper(queryClient),
    });
    await result.current.mutateAsync({ orderId: "order-1", payload: { type: "GARANTIE" } });

    expect(queryClient.getQueryData(warrantyClaimKeys.list("order-1"))).toEqual({
      data: [created],
      meta: { total: 1 },
    });
  });

  it("resolves the create without waiting for a list read that never answers", async () => {
    const created = claimFixture({ id: "claim-new" });
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === "POST") return jsonResponse(created, 201);
      return new Promise<Response>(() => undefined);
    });
    const queryClient = createQueryClient();

    const { result } = renderHook(
      () => ({ create: useCreateWarrantyClaim(), lists: useWarrantyClaims("order-1") }),
      { wrapper: createWrapper(queryClient) },
    );
    await expect(
      result.current.create.mutateAsync({ orderId: "order-1", payload: { type: "GARANTIE" } }),
    ).resolves.toEqual(created);
  });

  it("sends only the patch it is given and stores the saved claim", async () => {
    const saved = claimFixture({ complaint: "Geräusch", claimedAmountNet: "120.00" });
    fetchMock.mockResolvedValue(jsonResponse(saved));
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useUpdateWarrantyClaim(), {
      wrapper: createWrapper(queryClient),
    });
    await result.current.mutateAsync({
      orderId: "order-1",
      claimId: "claim-1",
      payload: { complaint: "Geräusch", claimedAmountNet: 120 },
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/workshop/orders/order-1/warranty-claims/claim-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ complaint: "Geräusch", claimedAmountNet: 120 }),
      }),
    );
    expect(queryClient.getQueryData(warrantyClaimKeys.detail("order-1", "claim-1"))).toEqual(saved);
  });

  it("loads the list and a single claim through their query keys", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/warranty-claims")) return jsonResponse({ data: [claimFixture()], meta: { total: 1 } });
      return jsonResponse(claimFixture());
    });
    const queryClient = createQueryClient();
    const wrapper = createWrapper(queryClient);

    const list = renderHook(() => useWarrantyClaims("order-1"), { wrapper });
    await waitFor(() => expect(list.result.current.isSuccess).toBe(true));
    expect(list.result.current.data?.meta.total).toBe(1);

    const detail = renderHook(() => useWarrantyClaim("order-1", "claim-1"), { wrapper });
    await waitFor(() => expect(detail.result.current.isSuccess).toBe(true));
    expect(detail.result.current.data?.id).toBe("claim-1");
  });

  it("does not query a claim until one is selected", () => {
    const { result } = renderHook(() => useWarrantyClaim("order-1", null), {
      wrapper: createWrapper(createQueryClient()),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up on a save that does not answer, so the editor is never left waiting", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener("abort", () => reject(signal.reason));
          }),
      );

      const outcome = updateWarrantyClaim("order-1", "claim-1", { complaint: "Kupplung" }).catch(
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(WARRANTY_CLAIM_SAVE_TIMEOUT_MS);

      const error = await outcome;
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe("TimeoutError");
      expect((error as DOMException).message).toMatch(/may still have been saved/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a save that stalls before the request is sent, such as a token lookup", async () => {
    vi.useFakeTimers();
    try {
      // Ignores the abort signal, as a token lookup does: only the race can end this call.
      fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));

      const outcome = updateWarrantyClaim("order-1", "claim-1", { complaint: "Kupplung" }).catch(
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(WARRANTY_CLAIM_SAVE_TIMEOUT_MS);

      const error = await outcome;
      expect((error as DOMException).name).toBe("TimeoutError");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears its timer once a save is answered", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ id: "claim-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await updateWarrantyClaim("order-1", "claim-1", { complaint: "Kupplung" });

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a PDF that does not come back, so Print cannot stay busy", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            signal?.addEventListener("abort", () => reject(signal.reason));
          }),
      );

      const outcome = downloadWarrantyClaimPdf("order-1", "claim-1").catch(
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(WARRANTY_CLAIM_PDF_TIMEOUT_MS);

      const error = await outcome;
      expect((error as DOMException).name).toBe("TimeoutError");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the claim and the list again after a save fails, because the server may have applied it", async () => {
    const queryClient = createQueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "The claim changed." }, 409));

    const { result } = renderHook(() => useUpdateWarrantyClaim(), {
      wrapper: createWrapper(queryClient),
    });
    await expect(
      result.current.mutateAsync({
        orderId: "order-1",
        claimId: "claim-1",
        payload: { status: "APPROVED" },
      }),
    ).rejects.toThrow("The claim changed.");

    expect(invalidate).toHaveBeenCalledWith({
      queryKey: warrantyClaimKeys.detail("order-1", "claim-1"),
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: warrantyClaimKeys.lists("order-1") });
  });
});

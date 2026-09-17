import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithAuth } from "./client";
import { useStockTransfer } from "./stock-transfers";

vi.mock("./client", () => ({
  fetchWithAuth: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useStockTransfer", () => {
  afterEach(() => vi.clearAllMocks());

  it("preserves a redacted sourceLocationId from a destination-only response", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: "transfer-1",
        transferNumber: "ST-1",
        fromSiteId: "site-from",
        fromSiteName: "From",
        toSiteId: "site-to",
        toSiteName: "To",
        status: "SHIPPED",
        version: 1,
        requestedByUserId: "user-1",
        approvedByUserId: null,
        shippedByUserId: "user-1",
        receivedByUserId: null,
        rejectReason: null,
        cancelReason: null,
        createdAt: "2026-09-17T10:00:00.000Z",
        updatedAt: "2026-09-17T10:00:00.000Z",
        lines: [
          {
            id: "line-1",
            catalogItemId: "item-1",
            requestedQty: "1.000",
            approvedQty: "1.000",
            shippedQty: "1.000",
            receivedQty: "0.000",
            returnedQty: "0.000",
            sourceLocationId: null,
            destLocationId: "bin-to",
          },
        ],
      }),
    } as unknown as Response);

    const { result } = renderHook(() => useStockTransfer("transfer-1"), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.lines[0]?.sourceLocationId).toBeNull();
  });
});

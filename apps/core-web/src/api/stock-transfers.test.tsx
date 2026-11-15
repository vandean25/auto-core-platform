import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithAuth } from "./client";
import {
  stockTransferKeys,
  useApproveStockTransfer,
  useReceiveStockTransfer,
  useStockTransfer,
} from "./stock-transfers";

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
  it("does not leak raw backend message on mutation error and maps known code", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({
        code: "SELLER_IDENTITY_INCOMPLETE",
        message: "Raw backend transfer error message",
      }),
      status: 422,
    } as unknown as Response);

    const { result } = renderHook(() => useApproveStockTransfer("transfer-1"), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({ expectedVersion: 1 }),
    ).rejects.toThrow("Die Angaben zum Betrieb sind für den Versand unvollständig. Bitte ergänzen Sie sie.");

    await expect(
      result.current.mutateAsync({ expectedVersion: 1 }),
    ).rejects.not.toThrow("Raw backend transfer error message");
  });

  it("does not leak raw backend message when code is unknown", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({
        code: "SOME_UNKNOWN_CODE",
        message: "Internal unexpected transfer failure",
      }),
      status: 400,
    } as unknown as Response);

    const { result } = renderHook(() => useApproveStockTransfer("transfer-1"), {
      wrapper: createWrapper(),
    });

    await expect(
      result.current.mutateAsync({ expectedVersion: 1 }),
    ).rejects.toThrow("Umlagerung konnte nicht genehmigt werden");

    await expect(
      result.current.mutateAsync({ expectedVersion: 1 }),
    ).rejects.not.toThrow("Internal unexpected transfer failure");
  });

  // Regression (AUT-964): toast fired while detail cache still held "SHIPPED / receivedQty 0" because
  // onSuccess neither wrote the response into the detail cache nor awaited invalidateQueries.
  it("writes the server response to the detail cache and awaits invalidation before resolving", async () => {
    const shippedTransfer = {
      id: "transfer-1",
      transferNumber: "ST-1",
      fromSiteId: "site-from",
      fromSiteName: "From",
      toSiteId: "site-to",
      toSiteName: "To",
      status: "SHIPPED" as const,
      version: 1,
      requestedByUserId: "user-1",
      approvedByUserId: "user-1",
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
          requestedQty: "4.000",
          approvedQty: "4.000",
          shippedQty: "4.000",
          receivedQty: "0.000",
          returnedQty: "0.000",
          sourceLocationId: null,
          destLocationId: "bin-to",
        },
      ],
    };
    const completedTransfer = {
      ...shippedTransfer,
      status: "COMPLETED" as const,
      version: 2,
      receivedByUserId: "user-2",
      lines: [{ ...shippedTransfer.lines[0], receivedQty: "4.000" }],
    };

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    let resolveRefetch!: (value: Response) => void;
    let getCount = 0;
    vi.mocked(fetchWithAuth).mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/receive")) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue(completedTransfer),
        } as unknown as Response;
      }
      getCount += 1;
      if (getCount === 1) {
        return {
          ok: true,
          json: vi.fn().mockResolvedValue(shippedTransfer),
        } as unknown as Response;
      }
      return new Promise<Response>((resolve) => {
        resolveRefetch = resolve;
      });
    });

    const detailHook = renderHook(() => useStockTransfer("transfer-1"), { wrapper });
    await waitFor(() => expect(detailHook.result.current.data?.status).toBe("SHIPPED"));

    const receiveHook = renderHook(() => useReceiveStockTransfer("transfer-1"), { wrapper });
    let settled = false;
    const mutationPromise = receiveHook.result.current
      .mutateAsync({
        expectedVersion: 1,
        idempotencyKey: "idem-1",
        lines: [{ id: "line-1", receiveQty: 4, destLocationId: "bin-to" }],
      })
      .then((res) => {
        settled = true;
        return res;
      });

    // Immediately after POST /receive returns, the detail cache must already reflect COMPLETED
    // and mutateAsync must not settle before the active invalidation refetch completes.
    await waitFor(() =>
      expect(
        queryClient.getQueryData<typeof completedTransfer>(stockTransferKeys.detail("transfer-1"))
          ?.status,
      ).toBe("COMPLETED"),
    );
    expect(settled).toBe(false);

    resolveRefetch({
      ok: true,
      json: vi.fn().mockResolvedValue(completedTransfer),
    } as unknown as Response);

    await mutationPromise;
    expect(settled).toBe(true);
    expect(detailHook.result.current.data?.status).toBe("COMPLETED");
    expect(detailHook.result.current.data?.lines[0]?.receivedQty).toBe("4.000");
  });
});

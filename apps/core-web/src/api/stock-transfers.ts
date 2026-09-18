import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWithAuth } from "./client";
import type { components } from "./generated/openapi";

export const stockTransferKeys = {
  all: ["stock-transfers"] as const,
  list: (params: { page?: number; limit?: number; status?: string } = {}) =>
    [...stockTransferKeys.all, "list", params] as const,
  detail: (transferId: string) =>
    [...stockTransferKeys.all, "detail", transferId] as const,
} as const;

export type StockTransfer = components["schemas"]["StockTransferResponseDto"];
export type CreateStockTransferPayload =
  components["schemas"]["CreateStockTransferDto"];
export type ApproveStockTransferPayload =
  components["schemas"]["ApproveStockTransferDto"];
export type RejectStockTransferPayload =
  components["schemas"]["RejectStockTransferDto"];
export type CancelStockTransferPayload =
  components["schemas"]["CancelStockTransferDto"];
export type ShipStockTransferPayload =
  components["schemas"]["ShipStockTransferDto"];
export type ReceiveStockTransferPayload =
  components["schemas"]["ReceiveStockTransferDto"];
export type ReturnStockTransferPayload =
  components["schemas"]["ReturnStockTransferDto"];

const STOCK_TRANSFER_API = "/api/stock-transfers";

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = (await response.json().catch(() => undefined)) as
    | { message?: string }
    | undefined;
  return payload?.message || fallbackMessage;
}

async function parseStockTransferResponse(response: Response, fallbackMessage: string) {
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, fallbackMessage));
  }
  return (await response.json()) as StockTransfer;
}

function invalidateStockTransferQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  transferId?: string,
) {
  if (transferId) {
    queryClient.invalidateQueries({
      queryKey: stockTransferKeys.detail(transferId),
    });
  }
  queryClient.invalidateQueries({ queryKey: stockTransferKeys.all });
}

export function useStockTransfers(
  params: { page?: number; limit?: number; status?: string } = {},
) {
  return useQuery<StockTransfer[]>({
    queryKey: stockTransferKeys.list(params),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) searchParams.set(key, String(value));
      }
      const query = searchParams.toString();
      const response = await fetchWithAuth(
        query ? `${STOCK_TRANSFER_API}?${query}` : STOCK_TRANSFER_API,
      );
      if (!response.ok) throw new Error("Failed to fetch stock transfers");
      return (await response.json()) as StockTransfer[];
    },
  });
}

export function useStockTransfer(transferId: string) {
  return useQuery<StockTransfer>({
    queryKey: stockTransferKeys.detail(transferId),
    enabled: Boolean(transferId),
    queryFn: async () => {
      const response = await fetchWithAuth(
        `${STOCK_TRANSFER_API}/${transferId}`,
      );
      if (!response.ok) throw new Error("Failed to fetch stock transfer");
      return (await response.json()) as StockTransfer;
    },
  });
}

export function useCreateStockTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateStockTransferPayload) => {
      const response = await fetchWithAuth(STOCK_TRANSFER_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return parseStockTransferResponse(response, "Failed to create stock transfer");
    },
    onSuccess: (transfer) => {
      invalidateStockTransferQueries(queryClient, transfer.id);
    },
  });
}

export function useApproveStockTransfer(transferId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ApproveStockTransferPayload) => {
      const response = await fetchWithAuth(
        `${STOCK_TRANSFER_API}/${transferId}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      return parseStockTransferResponse(response, "Failed to approve stock transfer");
    },
    onSuccess: () => invalidateStockTransferQueries(queryClient, transferId),
  });
}

export function useRejectStockTransfer(transferId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: RejectStockTransferPayload) => {
      const response = await fetchWithAuth(
        `${STOCK_TRANSFER_API}/${transferId}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      return parseStockTransferResponse(response, "Failed to reject stock transfer");
    },
    onSuccess: () => invalidateStockTransferQueries(queryClient, transferId),
  });
}

export function useCancelStockTransfer(transferId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CancelStockTransferPayload) => {
      const response = await fetchWithAuth(
        `${STOCK_TRANSFER_API}/${transferId}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      return parseStockTransferResponse(response, "Failed to cancel stock transfer");
    },
    onSuccess: () => invalidateStockTransferQueries(queryClient, transferId),
  });
}

export function useShipStockTransfer(transferId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ShipStockTransferPayload) => {
      const response = await fetchWithAuth(
        `${STOCK_TRANSFER_API}/${transferId}/ship`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      return parseStockTransferResponse(response, "Failed to ship stock transfer");
    },
    onSuccess: () => invalidateStockTransferQueries(queryClient, transferId),
  });
}

export function useReceiveStockTransfer(transferId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ReceiveStockTransferPayload) => {
      const response = await fetchWithAuth(
        `${STOCK_TRANSFER_API}/${transferId}/receive`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      return parseStockTransferResponse(response, "Failed to receive stock transfer");
    },
    onSuccess: () => invalidateStockTransferQueries(queryClient, transferId),
  });
}

export function useReturnStockTransfer(transferId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ReturnStockTransferPayload) => {
      const response = await fetchWithAuth(
        `${STOCK_TRANSFER_API}/${transferId}/return`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      return parseStockTransferResponse(response, "Failed to return stock transfer");
    },
    onSuccess: () => invalidateStockTransferQueries(queryClient, transferId),
  });
}

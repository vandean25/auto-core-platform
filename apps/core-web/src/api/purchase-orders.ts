import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PurchaseOrder } from "./types";
import { fetchWithAuth } from "./client";
import type { DataTableQueryParams } from "@/hooks/useDataTableQuery";
import { buildDataTableUrl } from "./data-table-query";
import { inventoryKeys } from "./inventory";

const PO_API = "/api/purchase-orders";

export const purchaseOrderKeys = {
  all: ["purchase-orders"] as const,
  list: (queryParams?: DataTableQueryParams) =>
    [...purchaseOrderKeys.all, "list", queryParams] as const,
  detail: (id: string) => [...purchaseOrderKeys.all, "detail", id] as const,
};

type PurchaseOrderListResponse = {
  data: PurchaseOrder[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
};

export function usePurchaseOrders(queryParams?: DataTableQueryParams) {
  return useQuery<PurchaseOrderListResponse>({
    queryKey: purchaseOrderKeys.list(queryParams),
    queryFn: async () => {
      const url = buildDataTableUrl(PO_API, queryParams, {
        sortFieldMap: { vendor: "vendor.name" },
        searchFallbackFilterFields: ["order_number"],
        exactFilterMap: { status: "status" },
      });

      const res = await fetchWithAuth(url);
      if (!res.ok) throw new Error("Failed to fetch purchase orders");
      return res.json();
    },
    placeholderData: (previousData) => previousData,
  });
}

export function useCreatePO() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      vendorId: string;
      items: { catalogItemId: string; quantity: number; unitCost: number }[];
    }) => {
      const res = await fetchWithAuth(PO_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create PO");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all });
    },
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: purchaseOrderKeys.detail(id),
    queryFn: async () => {
      // The endpoint isn't explicitly defined in my previous view_file of controller, but usually we need one.
      // I see `receiveItems` uses `:id/receive`.
      // I should probably add `@Get(':id')` to backend too.
      const res = await fetchWithAuth(`${PO_API}/${id}`);
      if (!res.ok) throw new Error("Failed to fetch PO");
      return res.json() as Promise<PurchaseOrder>;
    },
    enabled: !!id,
  });
}

export function useMarkPOSent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`${PO_API}/${id}/mark-as-sent`, {
        method: "POST",
      });
      if (!res.ok) {
        const error = await res
          .json()
          .catch(() => ({ message: "Failed to mark PO as sent" }));
        throw new Error(error.message || "Failed to mark PO as sent");
      }
      return res.json();
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all });
    },
  });
}

export function useReceiveGoods() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      items,
    }: {
      orderId: string;
      items: { itemId: string; quantity: number }[];
    }) => {
      const res = await fetchWithAuth(`${PO_API}/${orderId}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error("Failed to receive goods");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: purchaseOrderKeys.detail(variables.orderId),
      });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
    },
  });
}

export function useAddPOItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      items,
    }: {
      orderId: string;
      items: { catalogItemId: string; quantity: number; unitCost: number }[];
    }) => {
      const res = await fetchWithAuth(`${PO_API}/${orderId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
      });
      if (!res.ok) throw new Error("Failed to add items to PO");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: purchaseOrderKeys.detail(variables.orderId),
      });
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all });
    },
  });
}

export function useUpdatePOItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      itemId,
      updates,
    }: {
      orderId: string;
      itemId: string;
      updates: { quantity?: number; unitCost?: number };
    }) => {
      const res = await fetchWithAuth(`${PO_API}/${orderId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("Failed to update PO item");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: purchaseOrderKeys.detail(variables.orderId),
      });
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all });
    },
  });
}

export function useDeletePOItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      orderId,
      itemId,
    }: {
      orderId: string;
      itemId: string;
    }) => {
      const res = await fetchWithAuth(`${PO_API}/${orderId}/items/${itemId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete PO item");
      return res.json();
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: purchaseOrderKeys.detail(variables.orderId),
      });
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all });
    },
  });
}

export function useDeletePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetchWithAuth(`${PO_API}/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const error = await res
          .json()
          .catch(() => ({ message: "Failed to delete purchase order" }));
        throw new Error(error.message || "Failed to delete purchase order");
      }
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: purchaseOrderKeys.all });
    },
  });
}

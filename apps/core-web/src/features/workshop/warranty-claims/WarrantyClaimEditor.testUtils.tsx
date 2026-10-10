import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { fetchWithAuth } from "@/api/client";
import type { WarrantyClaim, WorkshopTask } from "@/api/types";
import { toast } from "sonner";
import { WarrantyClaimEditor } from "./WarrantyClaimEditor";

export const fetchMock = vi.mocked(fetchWithAuth);
export const toastMock = vi.mocked(toast);

export function claimFixture(overrides: Partial<WarrantyClaim> = {}): WarrantyClaim {
  return {
    id: "claim-1",
    workshopOrderId: "order-1",
    type: "GARANTIE",
    status: "DRAFT",
    complaint: "Kupplung rutscht",
    causeCorrection: null,
    claimedAmountNet: "250.00",
    linesNetAmount: "250.00",
    externalReference: null,
    decisionDate: null,
    decisionNote: null,
    submittedAt: null,
    closedAt: null,
    createdAt: "2026-10-10T08:00:00.000Z",
    updatedAt: "2026-10-10T08:00:00.000Z",
    lines: [
      {
        id: "wcl-1",
        workshopTaskLineItemId: "item-labor",
        lineType: "LABOR",
        itemNo: "LAB-1",
        description: "Kupplung entlüften",
        quantity: "2.500",
        unitPrice: "100.00",
        netAmount: "250.00",
      },
    ],
    ...overrides,
  };
}

export const tasks = [
  {
    id: "task-1",
    title: "Kupplung",
    status: "IN_PROGRESS",
    done: false,
    lineItemsVersion: 1,
    lineItems: [
      {
        id: "item-labor",
        type: "LABOR",
        itemNo: "LAB-1",
        description: "Kupplung entlüften",
        qty: 2.5,
        unitPrice: 100,
      },
      {
        id: "item-part",
        type: "PART",
        itemNo: "A1234567",
        description: "Geberzylinder",
        qty: 1,
        unitPrice: 1000,
        partExecutionStatus: "PENDING_PICK",
      },
    ],
    createdAt: "2026-10-10T08:00:00.000Z",
    updatedAt: "2026-10-10T08:00:00.000Z",
  },
] as unknown as WorkshopTask[];

function queryClientWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

export function renderEditor(
  claim: WarrantyClaim,
  options: { lineClaimedElsewhere?: Map<string, string>; orderTasks?: WorkshopTask[] } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <WarrantyClaimEditor
      orderId="order-1"
      orderNumber="WO-2026-0007"
      claim={claim}
      tasks={options.orderTasks ?? tasks}
      lineClaimedElsewhere={options.lineClaimedElsewhere ?? new Map()}
    />,
    { wrapper: queryClientWrapper(queryClient) },
  );
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function payloadOf(call: unknown[] | undefined): Record<string, unknown> {
  const init = (call?.[1] ?? {}) as { body?: unknown };
  return init.body ? JSON.parse(String(init.body)) : {};
}

/** Fails every save that carries the field, with the message; other saves answer with the claim as sent. */
export function failSavesWith(field: string, message: string) {
  fetchMock.mockImplementation(async (_input, init) => {
    const payload = init?.body ? JSON.parse(String(init.body)) : {};
    if (field in payload) return jsonResponse({ message }, 500);
    return jsonResponse(claimFixture(payload));
  });
}

/** Lets pending state updates and the save that follows them run before the assertions. */
export function settle() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

/** Resets the mocks around every test, and mocks the save and toast boundaries the editor uses. */
export function useEditorMocks() {
  beforeEach(() => {
    toastMock.error.mockClear();
    toastMock.message.mockClear();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (_input, init) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse(claimFixture(payload));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

}

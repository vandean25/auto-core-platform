import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithAuth } from "@/api/client";
import type { WarrantyClaim, WorkshopTask } from "@/api/types";
import { WarrantyClaimEditor } from "./WarrantyClaimEditor";

vi.mock("@/api/client", () => ({
  fetchWithAuth: vi.fn(),
}));

const fetchMock = vi.mocked(fetchWithAuth);

function claimFixture(overrides: Partial<WarrantyClaim> = {}): WarrantyClaim {
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

const tasks = [
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

function renderEditor(
  claim: WarrantyClaim,
  options: { lineClaimedElsewhere?: Map<string, string>; orderTasks?: WorkshopTask[] } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(
    <WarrantyClaimEditor
      orderId="order-1"
      orderNumber="WO-2026-0007"
      claim={claim}
      tasks={options.orderTasks ?? tasks}
      lineClaimedElsewhere={options.lineClaimedElsewhere ?? new Map()}
    />,
    { wrapper: Wrapper },
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function payloadOf(call: unknown[] | undefined): Record<string, unknown> {
  const init = (call?.[1] ?? {}) as { body?: unknown };
  return init.body ? JSON.parse(String(init.body)) : {};
}

beforeEach(() => {
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

describe("WarrantyClaimEditor", () => {
  it("shows the claim status and lets the advisor submit a complete draft", () => {
    renderEditor(claimFixture());

    expect(screen.getByRole("heading", { name: /Garantie claim/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Complaint")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Mark submitted" })).toBeEnabled();
  });

  it("keeps the submit button off until the claim is complete", () => {
    renderEditor(claimFixture({ complaint: null, lines: [] }));

    expect(screen.getByRole("button", { name: "Mark submitted" })).toBeDisabled();
  });

  it("names the group of affected lines for assistive technology", () => {
    renderEditor(claimFixture());

    expect(screen.getByRole("group", { name: "Affected labor and parts" })).toBeInTheDocument();
  });

  it("locks the content once submitted, but keeps the OEM reference editable", () => {
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    expect(screen.getByLabelText("Complaint")).toBeDisabled();
    expect(screen.getByLabelText("Claimed amount (EUR, net)")).toBeDisabled();
    expect(screen.getByLabelText("Reference at the OEM")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Record approval" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Record rejection" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Mark submitted" })).not.toBeInTheDocument();
  });

  it("is read-only once closed and offers no further status change", () => {
    renderEditor(claimFixture({ status: "CLOSED", closedAt: "2026-10-11T09:00:00.000Z" }));

    expect(screen.getByText("This claim is closed and read-only.")).toBeInTheDocument();
    expect(screen.getByLabelText("Reference at the OEM")).toBeDisabled();
    expect(screen.getByLabelText("Decision date")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Close claim" })).not.toBeInTheDocument();
  });

  it("does not let a line be picked when another open claim already covers it", () => {
    renderEditor(claimFixture({ lines: [] }), {
      lineClaimedElsewhere: new Map([["item-part", "Kulanz claim"]]),
    });

    expect(screen.getByText("Already on Kulanz claim")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Geberzylinder/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Kupplung entlüften/ })).toBeEnabled();
  });

  it("keeps a cancelled line that is on the claim visible, so it can be removed", () => {
    const orderTasks = [
      {
        ...tasks[0],
        lineItems: [
          ...tasks[0].lineItems!,
          {
            id: "item-cancelled",
            type: "PART",
            itemNo: "B7654321",
            description: "Dichtsatz",
            qty: 1,
            unitPrice: 30,
            partExecutionStatus: "CANCELLED",
          },
        ],
      },
    ] as unknown as WorkshopTask[];
    renderEditor(
      claimFixture({
        lines: [
          ...claimFixture().lines,
          {
            id: "wcl-2",
            workshopTaskLineItemId: "item-cancelled",
            lineType: "PART",
            itemNo: "B7654321",
            description: "Dichtsatz",
            quantity: "1.000",
            unitPrice: "30.00",
            netAmount: "30.00",
          },
        ],
      }),
      { orderTasks },
    );

    expect(screen.getByText(/Cancelled on the order/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Dichtsatz/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Mark submitted" })).toBeDisabled();
  });

  it("autosaves only the field that changed, after the 750 ms debounce", async () => {
    renderEditor(claimFixture());

    fireEvent.change(screen.getByLabelText("Cause and correction"), {
      target: { value: "Geberzylinder getauscht" },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("/api/workshop/orders/order-1/warranty-claims/claim-1");
    expect(init).toMatchObject({ method: "PATCH" });
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ causeCorrection: "Geberzylinder getauscht" });
  });

  it("does not save an amount that cannot be read", async () => {
    renderEditor(claimFixture());

    fireEvent.change(screen.getByLabelText("Claimed amount (EUR, net)"), {
      target: { value: "12,345" },
    });

    expect(screen.getByText("Enter an amount in EUR with at most two decimals.")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves pending edits before it closes the claim", async () => {
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Reference at the OEM"), {
      target: { value: "OEM-REF-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close claim" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close claim" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ externalReference: "OEM-REF-9" });
    expect(payloadOf(fetchMock.mock.calls[1])).toEqual({ status: "CLOSED" });
  });

  it("does not close the claim when the pending edits fail to save", async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if ("externalReference" in payload) {
        return jsonResponse({ message: "The OEM reference could not be stored." }, 500);
      }
      return jsonResponse(claimFixture(payload));
    });
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Reference at the OEM"), {
      target: { value: "OEM-REF-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close claim" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close claim" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ externalReference: "OEM-REF-9" });
    expect(payloadOf(fetchMock.mock.calls[0])).not.toHaveProperty("status");
  });

  it("keeps the decision date and note the advisor entered when recording an approval", async () => {
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Decision date"), { target: { value: "2026-10-08" } });
    fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: "80% goodwill share" } });
    fireEvent.click(screen.getByRole("button", { name: "Record approval" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByLabelText("Decision date")).toHaveValue("2026-10-08");
    expect(within(dialog).getByLabelText("Decision note")).toHaveValue("80% goodwill share");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark approved" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(payloadOf(fetchMock.mock.calls[1])).toEqual({
      status: "APPROVED",
      decisionDate: "2026-10-08",
      decisionNote: "80% goodwill share",
    });
  });

  it("names each line with its quantity, price and reason for assistive technology", () => {
    renderEditor(claimFixture({ lines: [] }), {
      lineClaimedElsewhere: new Map([["item-part", "Kulanz claim"]]),
    });

    expect(screen.getByRole("checkbox", { name: /Kupplung entlüften.*2\.5 ×/ })).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: /Geberzylinder.*Already on Kulanz claim/ }),
    ).toBeDisabled();
  });

  it("saves an edit that is still waiting for the debounce when the editor unmounts", async () => {
    const { unmount } = renderEditor(claimFixture());

    fireEvent.change(screen.getByLabelText("Cause and correction"), {
      target: { value: "Geberzylinder getauscht" },
    });
    unmount();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ causeCorrection: "Geberzylinder getauscht" });
  });

  it("does not submit the claim when the pending edits fail to save", async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if ("causeCorrection" in payload) {
        return jsonResponse({ message: "The cause could not be stored." }, 500);
      }
      return jsonResponse(claimFixture(payload));
    });
    renderEditor(claimFixture());

    fireEvent.change(screen.getByLabelText("Cause and correction"), {
      target: { value: "Geberzylinder getauscht" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mark submitted" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ causeCorrection: "Geberzylinder getauscht" });
  });

  it("does not record an approval when the pending edits fail to save", async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if ("externalReference" in payload) {
        return jsonResponse({ message: "The OEM reference could not be stored." }, 500);
      }
      return jsonResponse(claimFixture(payload));
    });
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Reference at the OEM"), {
      target: { value: "OEM-REF-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record approval" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark approved" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ externalReference: "OEM-REF-9" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not print the claim when the pending edits fail to save", async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if ("externalReference" in payload) {
        return jsonResponse({ message: "The OEM reference could not be stored." }, 500);
      }
      return jsonResponse(claimFixture(payload));
    });
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Reference at the OEM"), {
      target: { value: "OEM-REF-9" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Print" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toMatch(/\/pdf$/);
  });

  it("keeps the decision dialog open, with the advisor's entries, while the decision is being saved", async () => {
    const pendingStatus: { answer?: (response: Response) => void } = {};
    fetchMock.mockImplementation(async (_input, init) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if ("status" in payload) {
        return new Promise<Response>((resolve) => {
          pendingStatus.answer = resolve;
        });
      }
      return jsonResponse(claimFixture(payload));
    });
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    fireEvent.change(screen.getByLabelText("Decision note"), { target: { value: "80% goodwill share" } });
    fireEvent.click(screen.getByRole("button", { name: "Record approval" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark approved" }));
    await waitFor(() => expect(pendingStatus.answer).toBeDefined());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    pendingStatus.answer?.(jsonResponse({ message: "The claim changed." }, 409));
    const settled = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(within(settled).getByRole("button", { name: "Mark approved" })).toBeEnabled(),
    );
    expect(within(settled).getByLabelText("Decision note")).toHaveValue("80% goodwill share");
  });

  it("saves the other edits when the claimed amount cannot be read and the editor unmounts", async () => {
    const { unmount } = renderEditor(claimFixture());

    fireEvent.change(screen.getByLabelText("Complaint"), {
      target: { value: "Kupplung rutscht bei Kaltstart" },
    });
    fireEvent.change(screen.getByLabelText("Claimed amount (EUR, net)"), {
      target: { value: "12,345" },
    });
    unmount();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(payloadOf(fetchMock.mock.calls[0])).toEqual({ complaint: "Kupplung rutscht bei Kaltstart" });
  });

  it("does not save on unmount when nothing is pending", async () => {
    const { unmount } = renderEditor(claimFixture());

    unmount();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

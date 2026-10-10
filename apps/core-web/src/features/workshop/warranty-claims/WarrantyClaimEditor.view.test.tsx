import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkshopTask } from "@/api/types";
import {
  claimFixture,
  renderEditor,
  tasks,
  useEditorMocks,
} from "./WarrantyClaimEditor.testUtils";

vi.mock("@/api/client", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

describe("WarrantyClaimEditor: claim view", () => {
  useEditorMocks();

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

  it("names each line with its quantity, price and reason for assistive technology", () => {
    renderEditor(claimFixture({ lines: [] }), {
      lineClaimedElsewhere: new Map([["item-part", "Kulanz claim"]]),
    });

    expect(screen.getByRole("checkbox", { name: /Kupplung entlüften.*2\.5 ×/ })).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: /Geberzylinder.*Already on Kulanz claim/ }),
    ).toBeDisabled();
  });
});

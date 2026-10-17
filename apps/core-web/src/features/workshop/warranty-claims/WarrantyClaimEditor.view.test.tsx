import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkshopTask } from "@/api/types";
import {
  claimFixture,
  kulanzLineClaimLabel,
  renderEditor,
  tasks,
  useEditorMocks,
  we,
  wt,
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

const garantieHeading = we.heading.replace("{{type}}", wt.GARANTIE);
const alreadyOnKulanz = we.alreadyOn.replace("{{claim}}", kulanzLineClaimLabel);

describe("WarrantyClaimEditor: claim view", () => {
  useEditorMocks();

  it("shows the claim status and lets the advisor submit a complete draft", () => {
    renderEditor(claimFixture());

    expect(screen.getByRole("heading", { name: garantieHeading })).toBeInTheDocument();
    expect(screen.getByLabelText(we.complaint)).toBeEnabled();
    expect(screen.getByRole("button", { name: we.markSubmitted })).toBeEnabled();
  });

  it("keeps the submit button off until the claim is complete", () => {
    renderEditor(claimFixture({ complaint: null, lines: [] }));

    expect(screen.getByRole("button", { name: we.markSubmitted })).toBeDisabled();
  });

  it("names the group of affected lines for assistive technology", () => {
    renderEditor(claimFixture());

    expect(screen.getByRole("group", { name: we.affectedLines })).toBeInTheDocument();
  });

  it("locks the content once submitted, but keeps the OEM reference editable", () => {
    renderEditor(
      claimFixture({
        status: "SUBMITTED_EXTERNALLY",
        submittedAt: "2026-10-10T09:00:00.000Z",
      }),
    );

    expect(screen.getByLabelText(we.complaint)).toBeDisabled();
    expect(screen.getByLabelText(we.amountLabel)).toBeDisabled();
    expect(screen.getByLabelText(we.oemReference)).toBeEnabled();
    expect(screen.getByRole("button", { name: we.recordApproval })).toBeEnabled();
    expect(screen.getByRole("button", { name: we.recordRejection })).toBeEnabled();
    expect(screen.queryByRole("button", { name: we.markSubmitted })).not.toBeInTheDocument();
  });

  it("is read-only once closed and offers no further status change", () => {
    renderEditor(claimFixture({ status: "CLOSED", closedAt: "2026-10-11T09:00:00.000Z" }));

    expect(screen.getByText(we.closedReadOnly)).toBeInTheDocument();
    expect(screen.getByLabelText(we.oemReference)).toBeDisabled();
    expect(screen.getByLabelText(we.decisionDate)).toBeDisabled();
    expect(screen.queryByRole("button", { name: we.closeClaim })).not.toBeInTheDocument();
  });

  it("does not let a line be picked when another open claim already covers it", () => {
    renderEditor(claimFixture({ lines: [] }), {
      lineClaimedElsewhere: new Map([["item-part", kulanzLineClaimLabel]]),
    });

    expect(screen.getByText(alreadyOnKulanz)).toBeInTheDocument();
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

    expect(screen.getByText(new RegExp(we.cancelledOnOrder.slice(0, 20)))).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Dichtsatz/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: we.markSubmitted })).toBeDisabled();
  });

  it("names each line with its quantity, price and reason for assistive technology", () => {
    renderEditor(claimFixture({ lines: [] }), {
      lineClaimedElsewhere: new Map([["item-part", kulanzLineClaimLabel]]),
    });

    expect(screen.getByRole("checkbox", { name: /Kupplung entlüften.*2\.5 ×/ })).toBeEnabled();
    expect(
      screen.getByRole("checkbox", { name: new RegExp(`Geberzylinder.*${alreadyOnKulanz}`) }),
    ).toBeDisabled();
  });
});

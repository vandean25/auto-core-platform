import { describe, expect, it } from "vitest";
import type { WarrantyClaim, WorkshopTask } from "@/api/types";
import {
  availableStatusChanges,
  buildClaimLineRows,
  buildClaimPatch,
  canSubmitClaim,
  draftFromClaim,
  formatEur,
  isWarrantyClaimContentEditable,
  isWarrantyClaimMetadataEditable,
  lineNetCents,
  parseClaimedAmount,
  selectedNetCents,
  toCents,
  warrantyClaimPdfFileName,
  type WarrantyClaimDraft,
} from "./warranty-claim-form";

const laborLine = {
  id: "wcl-1",
  workshopTaskLineItemId: "item-labor",
  lineType: "LABOR" as const,
  itemNo: "LAB-1",
  description: "Kupplung entlüften",
  quantity: "2.500",
  unitPrice: "100.00",
  netAmount: "250.00",
};

function claimFixture(overrides: Partial<WarrantyClaim> = {}): WarrantyClaim {
  return {
    id: "claim-1234abcd-0000",
    workshopOrderId: "order-1",
    type: "KULANZ",
    status: "DRAFT",
    complaint: "Kupplung rutscht",
    causeCorrection: null,
    claimedAmountNet: "1250.00",
    linesNetAmount: "250.00",
    externalReference: null,
    decisionDate: null,
    decisionNote: null,
    submittedAt: null,
    closedAt: null,
    createdAt: "2026-10-09T10:00:00.000Z",
    updatedAt: "2026-10-10T08:00:00.000Z",
    lines: [laborLine],
    ...overrides,
  };
}

function draftFixture(overrides: Partial<WarrantyClaimDraft> = {}): WarrantyClaimDraft {
  return {
    type: "KULANZ",
    complaint: "Kupplung rutscht",
    causeCorrection: "",
    claimedAmount: "1250.00",
    lineItemIds: ["item-labor"],
    externalReference: "",
    decisionDate: "",
    decisionNote: "",
    ...overrides,
  };
}

function tasksFixture(): WorkshopTask[] {
  return [
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
          partExecutionStatus: null,
        },
        {
          id: "item-part",
          type: "PART",
          itemNo: "A1234567",
          description: "Geberzylinder",
          qty: 1,
          unitPrice: 1000,
          partExecutionStatus: "STAGED",
        },
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
      createdAt: "2026-10-09T10:00:00.000Z",
      updatedAt: "2026-10-09T10:00:00.000Z",
    } as unknown as WorkshopTask,
  ];
}

describe("warranty claim form helpers", () => {
  describe("draftFromClaim", () => {
    it("starts from the saved claim with blanks for missing optional values", () => {
      expect(draftFromClaim(claimFixture())).toEqual({
        type: "KULANZ",
        complaint: "Kupplung rutscht",
        causeCorrection: "",
        claimedAmount: "1250.00",
        lineItemIds: ["item-labor"],
        externalReference: "",
        decisionDate: "",
        decisionNote: "",
      });
    });
  });

  describe("parseClaimedAmount", () => {
    it.each([
      ["1250", 1250],
      ["1250.5", 1250.5],
      ["1.250,50", 1250.5],
      ["1250,5", 1250.5],
      [" 99,99 ", 99.99],
    ])("reads %s as %s", (input, expected) => {
      expect(parseClaimedAmount(input)).toEqual({ valid: true, value: expected });
    });

    it("treats blank input as no amount", () => {
      expect(parseClaimedAmount("   ")).toEqual({ valid: true, value: null });
    });

    it.each(["12,345", "-5", "abc", "1000001", "1.2.3"])("rejects %s", (input) => {
      expect(parseClaimedAmount(input)).toEqual({ valid: false, value: null });
    });
  });

  describe("buildClaimPatch", () => {
    it("returns null when nothing differs from the saved draft", () => {
      const saved = draftFixture();
      expect(buildClaimPatch(saved, { ...saved, lineItemIds: ["item-labor"] })).toBeNull();
    });

    it("sends only the changed fields, with blanks as null", () => {
      const saved = draftFixture();
      expect(
        buildClaimPatch(saved, { ...saved, complaint: "   ", causeCorrection: "Geber getauscht" }),
      ).toEqual({ complaint: null, causeCorrection: "Geber getauscht" });
    });

    it("sends the amount as a number and leaves an unparsable amount out", () => {
      const saved = draftFixture();
      expect(buildClaimPatch(saved, { ...saved, claimedAmount: "980,50" })).toEqual({
        claimedAmountNet: 980.5,
      });
      expect(buildClaimPatch(saved, { ...saved, claimedAmount: "98,555" })).toBeNull();
    });

    it("compares the selected lines without regard to order", () => {
      const saved = draftFixture({ lineItemIds: ["a", "b"] });
      expect(buildClaimPatch(saved, { ...saved, lineItemIds: ["b", "a"] })).toBeNull();
      expect(buildClaimPatch(saved, { ...saved, lineItemIds: ["b"] })).toEqual({ lineItemIds: ["b"] });
    });

    it("clears the decision date with null", () => {
      const saved = draftFixture({ decisionDate: "2026-10-10" });
      expect(buildClaimPatch(saved, { ...saved, decisionDate: "" })).toEqual({ decisionDate: null });
    });
  });

  describe("line amounts", () => {
    it("rounds a line to whole cents half up, without float error", () => {
      expect(lineNetCents(1.5, 9.99)).toBe(1499)
      expect(lineNetCents(1.005, 1)).toBe(101)
      expect(lineNetCents(1.333, 10)).toBe(1333)
      expect(lineNetCents(2.5, 100)).toBe(25000)
    });

    it("reads API amounts into cents", () => {
      expect(toCents("250.00")).toBe(25000)
      expect(toCents("0.10")).toBe(10)
    });

    it("shows the snapshot for lines already on the claim and the live order values for the rest", () => {
      const claim = claimFixture({
        lines: [{ ...laborLine, unitPrice: "90.00", netAmount: "225.00" }],
      })
      const rows = buildClaimLineRows(tasksFixture(), claim.lines)

      const labor = rows.find((row) => row.id === "item-labor")
      expect(labor).toMatchObject({ attached: true, netCents: 22500, unitPrice: 90 })
      const part = rows.find((row) => row.id === "item-part")
      expect(part).toMatchObject({ attached: false, netCents: 100000, cancelledOnOrder: false })
    });

    it("leaves a cancelled line out unless it is on the claim, and flags it when it is", () => {
      const notAttached = buildClaimLineRows(tasksFixture(), [laborLine])
      expect(notAttached.map((row) => row.id)).toEqual(["item-labor", "item-part"])

      const attached = buildClaimLineRows(tasksFixture(), [
        laborLine,
        { ...laborLine, id: "wcl-2", workshopTaskLineItemId: "item-cancelled", lineType: "PART", itemNo: "B7654321", description: "Dichtsatz", netAmount: "30.00" },
      ])
      expect(attached.find((row) => row.id === "item-cancelled")).toMatchObject({
        attached: true,
        cancelledOnOrder: true,
        netCents: 3000,
      })
    });

    it("keeps a claim line whose order line is no longer listed, so it can still be removed", () => {
      const rows = buildClaimLineRows([], [laborLine]);
      expect(rows).toEqual([
        expect.objectContaining({ id: "item-labor", attached: true, taskTitle: "", netCents: 25000 }),
      ]);
    });

    it("totals the selected rows in cents", () => {
      const rows = buildClaimLineRows(tasksFixture(), [laborLine]);
      expect(selectedNetCents(rows, ["item-labor", "item-part"])).toBe(125000);
      expect(selectedNetCents(rows, [])).toBe(0);
    });
  });

  describe("status rules", () => {
    it("offers the same status changes as the API", () => {
      expect(availableStatusChanges("DRAFT")).toEqual(["SUBMITTED_EXTERNALLY", "CLOSED"]);
      expect(availableStatusChanges("SUBMITTED_EXTERNALLY")).toEqual(["APPROVED", "REJECTED", "CLOSED"]);
      expect(availableStatusChanges("APPROVED")).toEqual(["CLOSED"]);
      expect(availableStatusChanges("REJECTED")).toEqual(["CLOSED"]);
      expect(availableStatusChanges("CLOSED")).toEqual([]);
    });

    it("locks content after DRAFT and keeps reference fields editable until CLOSED", () => {
      expect(isWarrantyClaimContentEditable("DRAFT")).toBe(true);
      expect(isWarrantyClaimContentEditable("SUBMITTED_EXTERNALLY")).toBe(false);
      expect(isWarrantyClaimMetadataEditable("REJECTED")).toBe(true);
      expect(isWarrantyClaimMetadataEditable("CLOSED")).toBe(false);
    });

    it("enables submission only with a complaint, an amount above zero and a line", () => {
      expect(canSubmitClaim(draftFixture())).toBe(true);
      expect(canSubmitClaim(draftFixture({ complaint: "  " }))).toBe(false);
      expect(canSubmitClaim(draftFixture({ claimedAmount: "0" }))).toBe(false);
      expect(canSubmitClaim(draftFixture({ claimedAmount: "" }))).toBe(false);
      expect(canSubmitClaim(draftFixture({ lineItemIds: [] }))).toBe(false);
    });
  });

  describe("display", () => {
    it("formats euros in German notation and shows a dash for missing amounts", () => {
      expect(formatEur("1250")).toMatch(/^1\.250,00\s€$/);
      expect(formatEur(0.5)).toMatch(/^0,50\s€$/);
      expect(formatEur(null)).toBe("–");
      expect(formatEur("")).toBe("–");
    });

    it("names the PDF the way the API does", () => {
      expect(
        warrantyClaimPdfFileName({ id: "claim-1234abcd-0000", type: "GEWAEHRLEISTUNG" }, "WO 2026/0007"),
      ).toBe("gewaehrleistung-wo-2026-0007-claim-12.pdf");
    });
  });
});

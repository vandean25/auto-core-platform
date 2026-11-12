// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { ensureNamespaceLoaded } from "@/lib/i18n";
import type { WorkshopOrder } from "@/api/types";
import {
  PICK_ELIGIBLE_WORKSHOP_ORDER_STATUSES,
  getRequiredPartLines,
  getWorkshopCustomerDisplayName,
  isWorkshopOrderPickEligible,
} from "./pick-utils";

function createWorkshopOrder(
  overrides: Partial<WorkshopOrder> = {},
): WorkshopOrder {
  return {
    id: overrides.id ?? "order-1",
    order_number: overrides.order_number ?? "WO-2026-0001",
    status: overrides.status ?? "INTAKE",
    purpose: overrides.purpose ?? "CUSTOMER_REPAIR",
    customer_id: "customer-1",
    customer: {
      id: "customer-1",
      type: "PRIVATE",
      first_name: "Ada",
      last_name: "Lovelace",
      email: "ada@example.com",
      ...overrides.customer,
    },
    vehicle_id: "vehicle-1",
    vehicle: {
      id: "vehicle-1",
      make: "Audi",
      model: "A4",
      year: 2024,
    },
    odometer: 1000,
    fuel_level: 0.5,
    createdAt: "2026-04-17T00:00:00.000Z",
    tasks: [],
    ...overrides,
  };
}

describe("pick-utils", () => {
  beforeAll(async () => {
    await ensureNamespaceLoaded("workshop");
  });

  it("formats workshop customer names consistently", () => {
    expect(
      getWorkshopCustomerDisplayName(
        createWorkshopOrder({
          customer: {
            id: "customer-2",
            type: "COMPANY",
            company_name: "ACME Fleet",
            first_name: "",
            last_name: "",
            email: "fleet@example.com",
          },
        }),
      ),
    ).toBe("ACME Fleet");

    expect(
      getWorkshopCustomerDisplayName(
        createWorkshopOrder({
          customer: {
            id: "customer-3",
            type: "PRIVATE",
            first_name: "Grace",
            last_name: "Hopper",
            email: "grace@example.com",
          },
        }),
      ),
    ).toBe("Grace Hopper");
  });

  it("uses the shared eligible statuses for pick validation", () => {
    expect(PICK_ELIGIBLE_WORKSHOP_ORDER_STATUSES.has("INTAKE")).toBe(true);
    expect(PICK_ELIGIBLE_WORKSHOP_ORDER_STATUSES.has("IN_PROGRESS")).toBe(true);
    expect(PICK_ELIGIBLE_WORKSHOP_ORDER_STATUSES.has("COMPLETED")).toBe(false);

    expect(
      isWorkshopOrderPickEligible(
        createWorkshopOrder({
          status: "IN_PROGRESS",
          tasks: [
            {
              id: "task-1",
              title: "Inspect",
              lineItemsVersion: 0,
              status: "IN_PROGRESS",
              done: false,
              lineItems: [
                {
                  id: "line-1",
                  type: "PART",
                  catalogItemId: "catalog-1",
                  itemNo: "PART-1",
                  description: "Part 1",
                  qty: 1,
                  unitPrice: 10,
                },
              ],
            },
          ],
        }),
      ),
    ).toBe(true);
  });

  // AUT-988: free-text PART lines (no catalog item) kept free-text-only orders on the pick list.
  it("drops a work order whose PART lines are all free-text", () => {
    expect(
      isWorkshopOrderPickEligible(
        createWorkshopOrder({
          status: "IN_PROGRESS",
          tasks: [
            {
              id: "task-1",
              title: "Inspect",
              lineItemsVersion: 0,
              status: "IN_PROGRESS",
              done: false,
              lineItems: [
                {
                  id: "line-free",
                  type: "PART",
                  catalogItemId: null,
                  itemNo: "QA-FREE",
                  description: "Free-text part",
                  qty: 2,
                  unitPrice: 10,
                },
              ],
            },
          ],
        }),
      ),
    ).toBe(false);
  });

  // AUT-988: mixed orders offered free-text lines in the drawer and in "pick all".
  it("keeps only catalog-backed PART lines for a mixed work order", () => {
    const lines = getRequiredPartLines(
      createWorkshopOrder({
        status: "IN_PROGRESS",
        tasks: [
          {
            id: "task-1",
            title: "Inspect",
            lineItemsVersion: 0,
            status: "IN_PROGRESS",
            done: false,
            lineItems: [
              {
                id: "line-free",
                type: "PART",
                catalogItemId: null,
                itemNo: "QA-FREE",
                description: "Free-text part",
                qty: 2,
                unitPrice: 10,
              },
              {
                id: "line-catalog",
                type: "PART",
                catalogItemId: "catalog-1",
                itemNo: "PART-1",
                description: "Catalog part",
                qty: 1,
                unitPrice: 10,
              },
            ],
          },
        ],
      }),
    );

    expect(lines.map((line) => line.workshopTaskLineItemId)).toEqual([
      "line-catalog",
    ]);
  });
});

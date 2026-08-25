import { describe, expect, it } from "vitest";
import { customerKeys } from "@/api/customers";
import { hrKeys } from "@/api/hr";
import { inventoryKeys } from "@/api/inventory";
import { mechanicQueueKeys } from "@/api/mechanic";
import { purchaseInvoiceKeys } from "@/api/usePurchaseInvoices";
import { purchaseOrderKeys } from "@/api/purchase-orders";
import { salesOrderKeys } from "@/api/sales-orders";
import { vehicleKeys } from "@/api/vehicles";
import { vehicleStockKeys } from "@/api/vehicle-stock";
import { vendorKeys } from "@/api/vendors";
import { workshopKeys } from "@/api/workshop";
import {
  getDashboardSourceKeysForEntityType,
  getDomainQueryKeysForEntityType,
  isEntityUpdatedPayload,
} from "@/features/realtime/dashboard-entity-map";

describe("dashboard realtime entity mapping", () => {
  it("maps backend entity types to dashboard source keys", () => {
    expect(getDashboardSourceKeysForEntityType("PURCHASE_ORDER")).toEqual([
      "purchase-orders",
    ]);
    expect(getDashboardSourceKeysForEntityType("WORKSHOP_ORDER")).toEqual([
      "workshop-orders",
    ]);
    expect(getDashboardSourceKeysForEntityType("CATALOG_ITEM")).toEqual([
      "inventory",
    ]);
    expect(getDashboardSourceKeysForEntityType("VEHICLE")).toEqual([
      "vehicles",
      "vehicle-stock",
    ]);
    expect(getDashboardSourceKeysForEntityType("VEHICLE_PURCHASE")).toEqual([
      "vehicle-stock",
    ]);
    expect(getDashboardSourceKeysForEntityType("VEHICLE_SALE")).toEqual([
      "vehicle-stock",
    ]);
  });

  it("aliases PURCHASE_INVOICE dashboard source keys to purchase-bills and purchase-invoices", () => {
    expect(getDashboardSourceKeysForEntityType("PURCHASE_INVOICE")).toEqual([
      "purchase-bills",
      "purchase-invoices",
    ]);
  });

  it("maps WORKSHOP_ORDER to workshop domain query keys", () => {
    expect(getDomainQueryKeysForEntityType("WORKSHOP_ORDER")).toEqual([
      workshopKeys.all,
      mechanicQueueKeys.all,
    ]);
  });

  it("maps workshop task events to workshop and mechanic queue domain query keys", () => {
    expect(getDomainQueryKeysForEntityType("WORKSHOP_TASK")).toEqual([
      workshopKeys.all,
      mechanicQueueKeys.all,
    ]);
    expect(getDomainQueryKeysForEntityType("WORKSHOP_TASK_LINE_ITEM")).toEqual([
      workshopKeys.all,
      mechanicQueueKeys.all,
    ]);
    expect(getDomainQueryKeysForEntityType("WORKSHOP_MEDIA")).toEqual([
      workshopKeys.all,
      mechanicQueueKeys.all,
    ]);
    expect(getDomainQueryKeysForEntityType("LABOR_ENTRY")).toEqual([
      workshopKeys.all,
      mechanicQueueKeys.all,
    ]);
  });

  it("maps PURCHASE_INVOICE to purchase-invoice domain query keys", () => {
    expect(getDomainQueryKeysForEntityType("PURCHASE_INVOICE")).toEqual([
      purchaseInvoiceKeys.all,
    ]);
  });

  it("maps remaining entity types to their domain query-key factories", () => {
    expect(getDomainQueryKeysForEntityType("PURCHASE_ORDER")).toEqual([
      purchaseOrderKeys.all,
    ]);
    expect(getDomainQueryKeysForEntityType("SALES_ORDER")).toEqual([
      salesOrderKeys.all,
    ]);
    expect(getDomainQueryKeysForEntityType("CATALOG_ITEM")).toEqual([
      inventoryKeys.all,
    ]);
    expect(getDomainQueryKeysForEntityType("CUSTOMER")).toEqual([
      customerKeys.all,
    ]);
    expect(getDomainQueryKeysForEntityType("VENDOR")).toEqual([vendorKeys.all]);
  });

  it("preserves vehicle stock domain invalidation for vehicle events", () => {
    expect(getDomainQueryKeysForEntityType("VEHICLE")).toEqual([
      vehicleKeys.all,
      vehicleStockKeys.all,
    ]);
    expect(getDomainQueryKeysForEntityType("VEHICLE_PURCHASE")).toEqual([
      vehicleStockKeys.all,
    ]);
    expect(getDomainQueryKeysForEntityType("VEHICLE_SALE")).toEqual([
      vehicleStockKeys.all,
    ]);
  });

  it("maps HR attendance and leave requests to HR domain query keys", () => {
    expect(getDomainQueryKeysForEntityType("ATTENDANCE_EVENT")).toEqual([
      hrKeys.all,
    ]);
    expect(getDomainQueryKeysForEntityType("LEAVE_REQUEST")).toEqual([
      hrKeys.all,
      workshopKeys.planner(),
    ]);
    expect(getDomainQueryKeysForEntityType("EMPLOYEE_WORK_SCHEDULE")).toEqual([
      hrKeys.all,
    ]);
  });

  it("validates entity_updated payload shape", () => {
    expect(
      isEntityUpdatedPayload({
        type: "PURCHASE_INVOICE",
        action: "UPDATED",
        entityId: "abc",
        timestamp: "2026-03-09T17:00:00.000Z",
      }),
    ).toBe(true);

    expect(
      isEntityUpdatedPayload({
        type: "EMPLOYEE_WORK_SCHEDULE",
        action: "UPDATED",
        entityId: "schedule-1",
        timestamp: "2026-08-25T10:00:00.000Z",
      }),
    ).toBe(true);

    expect(
      isEntityUpdatedPayload({
        type: "NOT_REAL",
        action: "UPDATED",
      }),
    ).toBe(false);

    expect(
      isEntityUpdatedPayload({
        type: "PURCHASE_ORDER",
        action: "INVALID",
      }),
    ).toBe(false);

    expect(
      isEntityUpdatedPayload({
        type: "PURCHASE_INVOICE",
        action: "UPDATED",
        entityId: "abc",
        // missing timestamp
      }),
    ).toBe(false);

    expect(isEntityUpdatedPayload(null)).toBe(false);
    expect(isEntityUpdatedPayload(undefined)).toBe(false);
  });
});

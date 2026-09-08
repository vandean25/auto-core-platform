import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import Decimal = Prisma.Decimal;

export type PoItemWithOrderVendor = {
  id: string;
  quantity_received: Prisma.Decimal | number;
  quantity_invoiced: Prisma.Decimal | number;
  purchase_order: {
    vendor_id: string;
  };
};

export type LineInput = {
  purchaseOrderItemId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
};

export type CalculatedLineData = {
  tenant_id: string;
  purchase_order_item_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  line_total: number;
};

export function aggregatePoItemTotals(
  items: Array<{ purchaseOrderItemId?: string; quantity: number }>,
): Map<string, number> {
  const poItemTotals = new Map<string, number>();

  for (const line of items) {
    if (!line.purchaseOrderItemId) continue;
    const currentTotal = poItemTotals.get(line.purchaseOrderItemId) ?? 0;
    poItemTotals.set(line.purchaseOrderItemId, currentTotal + line.quantity);
  }

  return poItemTotals;
}

export function calculateLineAmounts(
  items: LineInput[],
  tenantId: string,
): { linesData: CalculatedLineData[]; totalAmount: number } {
  let totalAmount = 0;
  const linesData = items.map((line) => {
    const lineNet = line.quantity * line.unitPrice;
    const taxRate = line.taxRate ?? 20;
    const lineTax = lineNet * (taxRate / 100);
    const lineTotal = lineNet + lineTax;
    totalAmount += lineTotal;

    return {
      tenant_id: tenantId,
      purchase_order_item_id: line.purchaseOrderItemId,
      description: line.description,
      quantity: line.quantity,
      unit_price: line.unitPrice,
      tax_rate: taxRate,
      line_total: lineTotal,
    };
  });

  return { linesData, totalAmount };
}

export function validatePoItemsAvailability(
  poItemsById: Map<string, PoItemWithOrderVendor>,
  poItemTotals: Map<string, number>,
  vendorId: string,
): void {
  for (const [poItemId, requestedQuantity] of poItemTotals) {
    const poItem = poItemsById.get(poItemId);
    if (!poItem) {
      throw new NotFoundException(`PO Item ${poItemId} not found`);
    }

    if (poItem.purchase_order.vendor_id !== vendorId) {
      throw new BadRequestException(
        `PO Item ${poItemId} does not belong to vendor ${vendorId}`,
      );
    }

    const pending = new Decimal(poItem.quantity_received).sub(
      poItem.quantity_invoiced,
    );
    if (new Decimal(requestedQuantity).gt(pending)) {
      throw new BadRequestException(
        `Cannot invoice ${requestedQuantity} for PO Item ${poItemId}. Only ${pending.toString()} pending.`,
      );
    }
  }
}

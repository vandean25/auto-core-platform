import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuditLogAction,
  DiscountType,
  InvoiceStatus,
  InvoiceTaxMode,
  Prisma,
} from '@prisma/client';
import type { AuditService } from '../audit/audit.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { chunkedPromiseAll } from '../common/utils/promise.util.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import type {
  UpdateInvoiceDiscountLineDto,
  UpdateInvoiceDiscountsDto,
} from './dto/update-invoice-discounts.dto.js';
import { calculateInvoiceTotals } from './invoice-creation.helpers.js';
import { omitInvoiceSnapshot } from './invoice-response.mapper.js';
import { lineNetBeforeGlobalDiscount } from './invoice-snapshot-v2.js';

type ResolvedDiscount = {
  type: DiscountType | null;
  value: Prisma.Decimal | null;
  changed: boolean;
};

type ResolvedLineState = {
  id: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  lineDiscountType: DiscountType | null;
  lineDiscountValue: Prisma.Decimal | null;
  lineTotal: Prisma.Decimal;
  changed: boolean;
};

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function invalidDiscount(message: string): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'INVOICE_DISCOUNT_INVALID',
    message,
  });
}

function preserveExistingDiscount(
  label: string,
  existingType: DiscountType | null,
  existingValue: Prisma.Decimal | null,
  maxFlatAmount: Prisma.Decimal,
): ResolvedDiscount {
  const preservedValue = existingValue
    ? new Prisma.Decimal(existingValue)
    : null;
  if (
    existingType === DiscountType.FLAT_AMOUNT &&
    preservedValue?.gt(maxFlatAmount)
  ) {
    throw invalidDiscount(
      `${label} flat discount cannot exceed the applicable net amount.`,
    );
  }
  return { type: existingType, value: preservedValue, changed: false };
}

function validateNewDiscount(
  label: string,
  discountType: DiscountType,
  discountValue: Prisma.Decimal | number | string,
  maxFlatAmount: Prisma.Decimal,
): ResolvedDiscount {
  const decimalValue = new Prisma.Decimal(discountValue).toDecimalPlaces(
    2,
    Prisma.Decimal.ROUND_HALF_UP,
  );
  if (decimalValue.lte(0)) {
    throw invalidDiscount(`${label} discount value must be greater than zero.`);
  }
  if (discountType === DiscountType.PERCENTAGE && decimalValue.gt(100)) {
    throw invalidDiscount(`${label} percentage discount cannot exceed 100.`);
  }
  if (
    discountType === DiscountType.FLAT_AMOUNT &&
    decimalValue.gt(maxFlatAmount)
  ) {
    throw invalidDiscount(
      `${label} flat discount cannot exceed the applicable net amount.`,
    );
  }
  return { type: discountType, value: decimalValue, changed: true };
}

function resolvePatchedDiscount(
  label: string,
  discountType: DiscountType | null | undefined,
  discountValue: Prisma.Decimal | number | string | null | undefined,
  existingType: DiscountType | null,
  existingValue: Prisma.Decimal | null,
  maxFlatAmount: Prisma.Decimal,
): ResolvedDiscount {
  if (discountType === undefined && discountValue === undefined) {
    return preserveExistingDiscount(
      label,
      existingType,
      existingValue,
      maxFlatAmount,
    );
  }
  if (discountType === null && discountValue === null) {
    return { type: null, value: null, changed: true };
  }
  if (!isPresent(discountType) || !isPresent(discountValue)) {
    throw invalidDiscount(`${label} discount requires both type and value.`);
  }
  return validateNewDiscount(label, discountType, discountValue, maxFlatAmount);
}

function resolveLineStates(
  items: Array<{
    id: string;
    quantity: Prisma.Decimal;
    unit_price: Prisma.Decimal;
    tax_rate: Prisma.Decimal;
    line_discount_type: DiscountType | null;
    line_discount_value: Prisma.Decimal | null;
  }>,
  lineUpdates: UpdateInvoiceDiscountLineDto[],
): ResolvedLineState[] {
  const updatesById = new Map<string, UpdateInvoiceDiscountLineDto>();
  for (const update of lineUpdates) {
    if (updatesById.has(update.id)) {
      throw invalidDiscount('Duplicate line item id in discount update.');
    }
    updatesById.set(update.id, update);
  }

  for (const lineId of updatesById.keys()) {
    if (!items.some((item) => item.id === lineId)) {
      throw new UnprocessableEntityException({
        code: 'INVOICE_DISCOUNT_LINE_NOT_FOUND',
        message: 'Discount line item does not belong to this invoice.',
      });
    }
  }

  return items.map((item, index) => {
    const quantity = new Prisma.Decimal(item.quantity);
    const unitPrice = new Prisma.Decimal(item.unit_price);
    const taxRate = new Prisma.Decimal(item.tax_rate);
    const grossLine = quantity.mul(unitPrice);
    const patch = updatesById.get(item.id);
    const existingValue = item.line_discount_value
      ? new Prisma.Decimal(item.line_discount_value)
      : null;

    const resolved = patch
      ? resolvePatchedDiscount(
          `Line item ${index + 1}`,
          patch.discountType,
          patch.discountValue,
          item.line_discount_type,
          existingValue,
          grossLine,
        )
      : {
          type: item.line_discount_type,
          value: existingValue,
          changed: false,
        };

    const lineTotal = lineNetBeforeGlobalDiscount({
      quantity,
      unitPrice,
      lineDiscountType: resolved.type,
      lineDiscountValue: resolved.value,
    }).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    if (lineTotal.lt(0)) {
      throw invalidDiscount(`Line item ${index + 1} total cannot be negative.`);
    }

    return {
      id: item.id,
      quantity,
      unitPrice,
      taxRate,
      lineDiscountType: resolved.type,
      lineDiscountValue: resolved.value,
      lineTotal,
      changed: resolved.changed,
    };
  });
}

export async function executeUpdateInvoiceDiscounts(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    siteId: string;
    invoiceId: string;
    dto: UpdateInvoiceDiscountsDto;
    auditService: AuditService;
    tenantContext: TenantContextService;
  },
) {
  const { tenantId, siteId, invoiceId, dto, auditService, tenantContext } =
    params;

  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, tenant_id: tenantId, site_id: siteId },
    include: {
      items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      customer: true,
      vehicle: true,
      workshop_order: true,
    },
  });
  if (!invoice) {
    throw new NotFoundException('Invoice not found');
  }

  if (invoice.status !== InvoiceStatus.DRAFT) {
    throw new ConflictException({
      code: 'INVOICE_NOT_DRAFT',
      message: 'Discounts can only be updated on DRAFT invoices.',
    });
  }

  if (invoice.tax_mode !== InvoiceTaxMode.STANDARD) {
    throw invalidDiscount(
      'Discounts are only supported on STANDARD tax-mode invoices.',
    );
  }

  const resolvedLines = resolveLineStates(invoice.items, dto.lineItems ?? []);
  const netAfterLineDiscounts = resolvedLines.reduce(
    (sum, line) => sum.add(line.lineTotal),
    new Prisma.Decimal(0),
  );
  const resolvedGlobal = resolvePatchedDiscount(
    'Global',
    dto.globalDiscountType,
    dto.globalDiscountValue,
    invoice.global_discount_type,
    invoice.global_discount_value,
    netAfterLineDiscounts,
  );

  const totals = calculateInvoiceTotals(
    resolvedLines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxRate: line.taxRate,
      line_discount_type: line.lineDiscountType,
      line_discount_value: line.lineDiscountValue,
    })),
    resolvedGlobal.type,
    resolvedGlobal.value,
  );

  if (
    totals.totalNet.lt(0) ||
    totals.totalTax.lt(0) ||
    totals.totalGross.lt(0)
  ) {
    throw invalidDiscount('Invoice totals cannot be negative.');
  }

  const updatedHeader = await tx.invoice.updateMany({
    where: {
      id: invoiceId,
      tenant_id: tenantId,
      site_id: siteId,
      status: InvoiceStatus.DRAFT,
    },
    data: {
      global_discount_type: resolvedGlobal.type,
      global_discount_value: resolvedGlobal.value,
      total_net: totals.totalNet,
      total_tax: totals.totalTax,
      total_gross: totals.totalGross,
    },
  });
  if (updatedHeader.count !== 1) {
    throw new ConflictException({
      code: 'INVOICE_NOT_DRAFT',
      message: 'Discounts can only be updated on DRAFT invoices.',
    });
  }

  const changedLines = resolvedLines.filter((line) => line.changed);
  if (changedLines.length > 0) {
    await chunkedPromiseAll(
      changedLines,
      async (line) => {
        const updatedLine = await tx.invoiceItem.updateMany({
          where: { id: line.id, invoice_id: invoiceId, tenant_id: tenantId },
          data: {
            line_discount_type: line.lineDiscountType,
            line_discount_value: line.lineDiscountValue,
            line_total: line.lineTotal,
          },
        });
        if (updatedLine.count !== 1) {
          throw new UnprocessableEntityException({
            code: 'INVOICE_DISCOUNT_LINE_NOT_FOUND',
            message: 'Discount line item does not belong to this invoice.',
          });
        }
      },
      10,
    );
  }

  await auditService.recordTenantMutation(
    {
      entityType: 'Invoice',
      entityId: invoiceId,
      action: AuditLogAction.UPDATE,
      actorUserId: tenantContext.getAuthenticatedUser()?.userId ?? null,
      before: {
        global_discount_type: invoice.global_discount_type,
        global_discount_value:
          invoice.global_discount_value?.toFixed(2) ?? null,
        line_items: invoice.items.map((item) => ({
          id: item.id,
          line_discount_type: item.line_discount_type,
          line_discount_value: item.line_discount_value?.toFixed(2) ?? null,
        })),
      },
      after: {
        global_discount_type: resolvedGlobal.type,
        global_discount_value: resolvedGlobal.value?.toFixed(2) ?? null,
        line_items: resolvedLines.map((line) => ({
          id: line.id,
          line_discount_type: line.lineDiscountType,
          line_discount_value: line.lineDiscountValue?.toFixed(2) ?? null,
        })),
      },
    },
    tx,
  );

  const updated = await tx.invoice.findFirst({
    where: { id: invoiceId, tenant_id: tenantId, site_id: siteId },
    include: {
      items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      customer: true,
      vehicle: true,
      workshop_order: true,
    },
  });
  if (!updated) {
    throw new NotFoundException('Invoice not found');
  }

  return omitInvoiceSnapshot({
    ...updated,
    vehicle: updated.vehicle
      ? stripVehicleIdentityResolutionState(updated.vehicle)
      : updated.vehicle,
  });
}

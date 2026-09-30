import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  DiscountType,
  InvoiceStatus,
  Prisma,
  WorkshopPartLineExecutionStatus,
  WorkshopOrderStatus,
} from '@prisma/client';
import { isTaskBlockedByParts } from '../parts-requisition/parts-requisition.helpers.js';
import { assertPersistedSiteId } from '../site/document-retarget.helpers.js';
import { omitInvoiceSnapshot } from './invoice-response.mapper.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import type { CreateDraftInvoiceDto } from './dto/create-draft-invoice.dto.js';
import type { PrismaService } from '../prisma/prisma.service.js';

export const DEFAULT_VAT_RATE = new Prisma.Decimal(
  process.env.DEFAULT_VAT_RATE ?? 20,
);
export const DEFAULT_DUE_DAYS = 14;

export interface CustomerAddressLike {
  street?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_country?: string | null;
}

export interface InvoiceCustomerAddressSnapshot {
  street: string;
  city: string;
  postal_code: string;
  country: string;
}

export type InvoiceLineItemCreateWithoutInvoiceInput =
  Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput;

export interface DraftInvoiceLineItemInput {
  catalog_item_id?: string | null;
  catalogItemId?: string | null;
  description: string;
  quantity: Prisma.Decimal | number | string;
  unit_price?: Prisma.Decimal | number | string;
  unitPrice?: Prisma.Decimal | number | string;
  type?: string | null;
  revenue_group_name?: string | null;
  revenueGroupName?: string | null;
  tax_rate?: Prisma.Decimal | number | string;
  taxRate?: Prisma.Decimal | number | string;
  line_discount_type?: DiscountType | null;
  line_discount_value?: Prisma.Decimal | number | string | null;
  part_execution_status?: WorkshopPartLineExecutionStatus | null;
  tenant_id?: string;
}

export interface InvoiceTotals {
  subtotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  totalNet: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalGross: Prisma.Decimal;
}

export function validateCustomerAddress(
  customer: CustomerAddressLike | null | undefined,
): void {
  if (!customer) {
    throw new BadRequestException('Customer address is required');
  }

  const street = (customer.street ?? customer.address_street)?.trim();
  const city = (customer.city ?? customer.address_city)?.trim();
  const postalCode = (customer.postal_code ?? customer.address_zip)?.trim();
  const country = (customer.country ?? customer.address_country)?.trim();

  if (!street || !city || !postalCode || !country) {
    throw new BadRequestException(
      'Customer address is incomplete: street, city, postal code, and country are required',
    );
  }
}

export function buildInvoiceCustomerAddressSnapshot(
  customer: CustomerAddressLike,
): InvoiceCustomerAddressSnapshot {
  validateCustomerAddress(customer);
  return {
    street: (customer.street ?? customer.address_street)!.trim(),
    city: (customer.city ?? customer.address_city)!.trim(),
    postal_code: (customer.postal_code ?? customer.address_zip)!.trim(),
    country: (customer.country ?? customer.address_country)!.trim(),
  };
}

export function assertDiscountPair(
  label: string,
  discountType: DiscountType | null | undefined,
  discountValue: Prisma.Decimal | number | string | null | undefined,
): void {
  const hasType = discountType !== null && discountType !== undefined;
  const hasValue = discountValue !== null && discountValue !== undefined;
  if (hasType !== hasValue) {
    throw new BadRequestException(
      `${label} discount requires both type and value.`,
    );
  }
}

export function buildInvoiceDueDate(
  fromDate = new Date(),
  dueDays = DEFAULT_DUE_DAYS,
): Date {
  const dueDate = new Date(fromDate);
  dueDate.setDate(dueDate.getDate() + dueDays);
  return dueDate;
}

export function buildDraftInvoiceLineItem(
  item: DraftInvoiceLineItemInput,
  lineIndex?: number,
  tenantId?: string,
): Prisma.InvoiceItemUncheckedCreateWithoutInvoiceInput {
  const quantity = new Prisma.Decimal(item.quantity);
  const unitPrice = new Prisma.Decimal(item.unit_price ?? item.unitPrice ?? 0);
  const taxRate = new Prisma.Decimal(
    item.tax_rate ?? item.taxRate ?? DEFAULT_VAT_RATE,
  );
  const net = quantity.mul(unitPrice);

  const discountType = item.line_discount_type ?? null;
  const discountValue =
    item.line_discount_value !== null && item.line_discount_value !== undefined
      ? new Prisma.Decimal(item.line_discount_value)
      : null;

  if (lineIndex !== undefined) {
    assertDiscountPair(
      `Line item ${lineIndex + 1}`,
      discountType,
      discountValue,
    );
  }

  let revenueGroupName =
    item.revenue_group_name ?? item.revenueGroupName ?? null;
  if (!revenueGroupName && item.type === 'LABOR') {
    revenueGroupName = 'Labor / workshop services';
  }

  return {
    tenant_id: tenantId ?? item.tenant_id ?? '',
    catalog_item_id: item.catalog_item_id ?? item.catalogItemId ?? null,
    description: item.description,
    quantity,
    unit_price: unitPrice,
    tax_rate: taxRate,
    line_discount_type: discountType,
    line_discount_value: discountValue,
    line_total: net,
    revenue_group_name: revenueGroupName,
  };
}

export function calculateInvoiceTotals(
  lineItems: Array<{
    quantity: Prisma.Decimal | number | string;
    unit_price?: Prisma.Decimal | number | string;
    unitPrice?: Prisma.Decimal | number | string;
    tax_rate?: Prisma.Decimal | number | string;
    taxRate?: Prisma.Decimal | number | string;
  }>,
): InvoiceTotals {
  let subtotal = new Prisma.Decimal(0);
  let taxTotal = new Prisma.Decimal(0);

  for (const item of lineItems) {
    const qty = new Prisma.Decimal(item.quantity);
    const price = new Prisma.Decimal(item.unit_price ?? item.unitPrice ?? 0);
    const rate = new Prisma.Decimal(
      item.tax_rate ?? item.taxRate ?? DEFAULT_VAT_RATE,
    );
    const net = qty.mul(price);
    const tax = net.mul(rate).div(100);

    subtotal = subtotal.add(net);
    taxTotal = taxTotal.add(tax);
  }

  const total = subtotal.add(taxTotal);
  return {
    subtotal,
    taxTotal,
    total,
    totalNet: subtotal,
    totalTax: taxTotal,
    totalGross: total,
  };
}

export async function executeCreateDraftInvoice(
  prisma: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  siteId: string,
  dto: CreateDraftInvoiceDto | { workshopOrderId: string },
) {
  const runner = async (tx: Prisma.TransactionClient) => {
    let order = await tx.workshopOrder.findFirst({
      where: {
        id: dto.workshopOrderId,
        tenant_id: tenantId,
        site_id: siteId,
      },
      include: {
        tasks: {
          include: {
            line_items: {
              include: {
                parts_reservations: {
                  select: {
                    status: true,
                    quantity: true,
                    quantity_consumed: true,
                    quantity_returned: true,
                    quantity_staged: true,
                  },
                },
              },
            },
          },
        },
        invoice: { select: { id: true, invoice_number: true } },
      },
    });

    if (!order) {
      throw new NotFoundException(
        `Workshop order ${dto.workshopOrderId} not found`,
      );
    }

    if (order.invoice) {
      throw new BadRequestException('Workshop order is already invoiced');
    }

    if (order.status !== WorkshopOrderStatus.COMPLETED) {
      throw new BadRequestException(
        'Only COMPLETED workshop orders can create invoices',
      );
    }

    const taskIds = order.tasks.map((task) => task.id).sort();
    if (taskIds.length > 0) {
      // eslint-disable-next-line no-restricted-syntax -- invoice creation shares the task-first mutation lock.
      await tx.$queryRaw`
        SELECT id
        FROM workshop_tasks
        WHERE tenant_id = ${tenantId}
          AND id IN (${Prisma.join(taskIds)})
        ORDER BY id
        FOR UPDATE
      `;

      const lockedOrder = await tx.workshopOrder.findFirst({
        where: {
          id: dto.workshopOrderId,
          tenant_id: tenantId,
          site_id: siteId,
        },
        include: {
          tasks: {
            include: {
              line_items: {
                include: {
                  parts_reservations: {
                    select: {
                      status: true,
                      quantity: true,
                      quantity_consumed: true,
                      quantity_returned: true,
                      quantity_staged: true,
                    },
                  },
                },
              },
            },
          },
          invoice: { select: { id: true, invoice_number: true } },
        },
      });
      if (!lockedOrder) {
        throw new NotFoundException(
          `Workshop order ${dto.workshopOrderId} not found`,
        );
      }
      order = lockedOrder;
    }

    if (
      order.tasks.some((task) =>
        isTaskBlockedByParts({
          lines: task.line_items,
          reservations: task.line_items.flatMap(
            (line) => line.parts_reservations ?? [],
          ),
        }),
      )
    ) {
      throw new ConflictException(
        'Workshop order cannot be invoiced while part work is incomplete.',
      );
    }

    const lineItems = order.tasks
      .flatMap((task) => task.line_items)
      .filter(
        (line) =>
          line.part_execution_status !==
          WorkshopPartLineExecutionStatus.CANCELLED,
      );
    if (lineItems.length === 0) {
      throw new BadRequestException(
        'Cannot create invoice because no labor/parts lines exist on tasks',
      );
    }

    const itemsData = lineItems.map((line, index) =>
      buildDraftInvoiceLineItem(line, index, tenantId),
    );
    const totals = calculateInvoiceTotals(lineItems);
    assertDiscountPair('Global', null, null);

    try {
      if (!order.customer_id) {
        throw new BadRequestException(
          'Workshop order has no customer to invoice',
        );
      }
      const orderSiteId = assertPersistedSiteId(
        order.site_id,
        'Workshop order site ownership is required',
      );
      const site = await tx.site.findFirst({
        where: { id: orderSiteId, tenant_id: tenantId },
        select: { id: true, legal_entity_id: true },
      });
      if (!site) {
        throw new NotFoundException('Workshop order site not found');
      }

      const invoice = await tx.invoice.create({
        data: {
          tenant_id: tenantId,
          customer_id: order.customer_id,
          vehicle_id: order.vehicle_id,
          workshop_order_id: order.id,
          site_id: site.id,
          legal_entity_id: site.legal_entity_id,
          currency: 'EUR',
          status: InvoiceStatus.DRAFT,
          date: new Date(),
          due_date: buildInvoiceDueDate(),
          total_net: totals.totalNet,
          total_tax: totals.totalTax,
          total_gross: totals.totalGross,
          notes: order.notes,
          items: {
            create: itemsData,
          },
        },
        include: {
          items: true,
          customer: true,
          vehicle: true,
          workshop_order: true,
        },
      });
      return omitInvoiceSnapshot({
        ...invoice,
        vehicle: invoice.vehicle
          ? stripVehicleIdentityResolutionState(invoice.vehicle)
          : invoice.vehicle,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Workshop order is already invoiced');
      }
      throw error;
    }
  };

  if ('$transaction' in prisma && typeof prisma.$transaction === 'function') {
    return prisma.$transaction(runner);
  }
  return runner(prisma);
}

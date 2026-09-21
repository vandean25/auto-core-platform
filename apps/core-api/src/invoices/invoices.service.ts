import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { FinanceService } from '../finance/finance.service.js';
import {
  DiscountType,
  InvoiceStatus,
  Prisma,
  WorkshopPartLineExecutionStatus,
  WorkshopOrderStatus,
} from '@prisma/client';
import type { WorkshopTaskLineItem } from '@prisma/client';
import {
  assertInvoiceHasSourceDocument,
  InvoiceSnapshotCommitService,
} from './invoice-snapshot-commit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  bindStatusUpdateMany,
  guardedStatusUpdate,
} from '../common/utils/status-transition.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import { isTaskBlockedByParts } from '../parts-requisition/parts-requisition.helpers.js';
import { assertPersistedSiteId } from '../site/document-retarget.helpers.js';

const DEFAULT_VAT_RATE = new Prisma.Decimal(process.env.DEFAULT_VAT_RATE ?? 20);
const DEFAULT_DUE_DAYS = 14;

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly snapshotCommit: InvoiceSnapshotCommitService,
  ) {}

  async createDraftInvoice(workshopOrderId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await this.financeService.validateTransactionDate(new Date());

    return this.prisma.$transaction(async (tx) => {
      let order = await tx.workshopOrder.findFirst({
        where: { id: workshopOrderId, tenant_id: tenantId, site_id: siteId },
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
          `Workshop order ${workshopOrderId} not found`,
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
          where: { id: workshopOrderId, tenant_id: tenantId, site_id: siteId },
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
            `Workshop order ${workshopOrderId} not found`,
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

      const { itemsData, totalNet, totalTax } = this.buildInvoiceItems(
        lineItems,
        tenantId,
      );
      const totalGross = totalNet.add(totalTax);
      this.assertDiscountPair('Global', null, null);
      itemsData.forEach((item, index) => {
        this.assertDiscountPair(
          `Line item ${index + 1}`,
          item.line_discount_type,
          item.line_discount_value,
        );
      });

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
            due_date: this.buildDueDate(),
            total_net: totalNet,
            total_tax: totalTax,
            total_gross: totalGross,
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
        return {
          ...invoice,
          vehicle: invoice.vehicle
            ? stripVehicleIdentityResolutionState(invoice.vehicle)
            : invoice.vehicle,
        };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new BadRequestException('Workshop order is already invoiced');
        }
        throw error;
      }
    });
  }

  async issueInvoice(invoiceId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, tenant_id: tenantId },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          customer: true,
          vehicle: true,
          workshop_order: true,
        },
      });

      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      if (!invoice.workshop_order_id) {
        throw new BadRequestException(
          'Invoice is not linked to a workshop order',
        );
      }

      if (invoice.status !== InvoiceStatus.DRAFT) {
        throw new BadRequestException('Only DRAFT invoices can be issued');
      }

      assertInvoiceHasSourceDocument(invoice);

      await this.financeService.validateTransactionDate(invoice.date);

      const invoiceNumber =
        invoice.invoice_number ??
        (await this.generateInvoiceNumber(tx, tenantId));

      const prepared = await this.snapshotCommit.prepareV2Snapshot({
        tx,
        tenantId,
        invoice,
        invoiceNumber,
      });

      await guardedStatusUpdate(bindStatusUpdateMany(tx.invoice), {
        id: invoiceId,
        tenantId,
        from: InvoiceStatus.DRAFT,
        to: InvoiceStatus.ISSUED,
        conflictMessage: 'Invoice was already transitioned by another request',
      });

      await tx.invoice.updateMany({
        where: { id: invoiceId, tenant_id: tenantId },
        data: {
          invoice_number: invoiceNumber,
        },
      });

      await this.snapshotCommit.persistV2Snapshot(
        tx,
        tenantId,
        invoiceId,
        prepared,
      );

      await guardedStatusUpdate(bindStatusUpdateMany(tx.workshopOrder), {
        id: invoice.workshop_order_id,
        tenantId,
        from: WorkshopOrderStatus.COMPLETED,
        to: WorkshopOrderStatus.INVOICED,
        conflictMessage:
          'Workshop order was already invoiced or is no longer COMPLETED',
      });

      const updated = await tx.invoice.findFirst({
        where: { id: invoiceId, tenant_id: tenantId },
        include: {
          items: { orderBy: { createdAt: 'asc' } },
          customer: true,
          vehicle: true,
          workshop_order: true,
        },
      });

      if (!updated) {
        throw new NotFoundException('Invoice not found');
      }

      return {
        ...updated,
        vehicle: updated.vehicle
          ? stripVehicleIdentityResolutionState(updated.vehicle)
          : updated.vehicle,
      };
    });
  }

  private buildInvoiceItems(
    lineItems: WorkshopTaskLineItem[],
    tenantId: string,
  ) {
    let totalNet = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);

    const itemsData = lineItems.map((line) => {
      const quantity = new Prisma.Decimal(line.quantity);
      const unitPrice = new Prisma.Decimal(line.unit_price);
      const net = this.calculateLineNet(quantity, unitPrice);
      const tax = this.calculateLineTax(net, DEFAULT_VAT_RATE);

      totalNet = totalNet.add(net);
      totalTax = totalTax.add(tax);

      return {
        tenant_id: tenantId,
        catalog_item_id: line.catalog_item_id,
        description: line.description,
        quantity,
        unit_price: unitPrice,
        tax_rate: DEFAULT_VAT_RATE,
        line_discount_type: null,
        line_discount_value: null,
        line_total: net,
        revenue_group_name:
          line.type === 'LABOR' ? 'Labor / workshop services' : null,
      };
    });

    return { itemsData, totalNet, totalTax };
  }

  private calculateLineNet(
    quantity: Prisma.Decimal,
    unitPrice: Prisma.Decimal,
  ) {
    return quantity.mul(unitPrice);
  }

  private calculateLineTax(net: Prisma.Decimal, taxRate: Prisma.Decimal) {
    return net.mul(taxRate).div(100);
  }

  private assertDiscountPair(
    label: string,
    discountType: DiscountType | null | undefined,
    discountValue: Prisma.Decimal | number | string | null | undefined,
  ) {
    const hasType = discountType !== null && discountType !== undefined;
    const hasValue = discountValue !== null && discountValue !== undefined;
    if (hasType !== hasValue) {
      throw new BadRequestException(
        `${label} discount requires both type and value.`,
      );
    }
  }

  private buildDueDate() {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + DEFAULT_DUE_DAYS);
    return dueDate;
  }

  private async generateInvoiceNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `RE-${year}-`;

    const sequence = await tx.invoiceSequence.upsert({
      where: { tenant_id_year: { tenant_id: tenantId, year } },
      update: { current: { increment: 1 } },
      create: { tenant_id: tenantId, year, current: 1 },
    });

    return `${prefix}${sequence.current.toString().padStart(4, '0')}`;
  }
}

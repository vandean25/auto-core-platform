import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';
import {
  DiscountType,
  InvoiceStatus,
  Prisma,
  WorkshopOrderStatus,
} from '@prisma/client';
import type { WorkshopTaskLineItem } from '@prisma/client';
import { buildInvoiceSnapshot } from './invoice-snapshot';
import { TenantContextService } from '../common/services/tenant-context.service';

const DEFAULT_VAT_RATE = new Prisma.Decimal(process.env.DEFAULT_VAT_RATE ?? 20);
const DEFAULT_DUE_DAYS = 14;

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async createDraftInvoice(workshopOrderId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.financeService.validateTransactionDate(new Date());

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.workshopOrder.findFirst({
        where: { id: workshopOrderId, tenant_id: tenantId },
        include: {
          tasks: {
            include: {
              line_items: true,
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

      const lineItems = order.tasks.flatMap((task) => task.line_items);
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
        return await tx.invoice.create({
          data: {
            tenant_id: tenantId,
            customer_id: order.customer_id,
            vehicle_id: order.vehicle_id,
            workshop_order_id: order.id,
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

      await this.financeService.validateTransactionDate(invoice.date);

      const updateResult = await tx.invoice.updateMany({
        where: { id: invoiceId, status: InvoiceStatus.DRAFT },
        data: {
          status: InvoiceStatus.ISSUED,
        },
      });

      if (updateResult.count === 0) {
        throw new BadRequestException('Only DRAFT invoices can be issued');
      }

      const invoiceNumber =
        invoice.invoice_number ??
        (await this.generateInvoiceNumber(tx, tenantId));
      const snapshot = buildInvoiceSnapshot({
        ...invoice,
        invoice_number: invoiceNumber,
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          invoice_number: invoiceNumber,
          snapshot,
        },
      });

      await tx.workshopOrder.update({
        where: { id: invoice.workshop_order_id },
        data: { status: WorkshopOrderStatus.INVOICED },
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

      return updated;
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
        description: line.description,
        quantity,
        unit_price: unitPrice,
        tax_rate: DEFAULT_VAT_RATE,
        line_discount_type: null,
        line_discount_value: null,
        line_total: net,
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

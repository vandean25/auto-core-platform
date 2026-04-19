import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrderStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { FinanceService } from '../../finance/finance.service';
import { TenantContextService } from '../../common/services/tenant-context.service';

@Injectable()
export class SalesOrderService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(FinanceService) private financeService: FinanceService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  async create(createDto: CreateSalesOrderDto) {
    const tenantId = await this.tenantContext.getTenantId();
    // Get and increment sales order number atomically
    const currentYear = new Date().getFullYear();
    const settings = await this.prisma.$transaction(async (tx) => {
      await tx.financeSettings.upsert({
        where: { tenant_id: tenantId },
        update: {},
        create: {
          tenant_id: tenantId,
          fiscal_year_start_month: 1,
          lock_date: null,
          next_invoice_number: 1001,
          invoice_prefix: `RE-${currentYear}-`,
          next_sales_order_number: 1001,
          sales_order_prefix: `SO-${currentYear}-`,
          next_workshop_order_number: 1,
          workshop_order_prefix: `WO-${currentYear}-`,
        },
      });

      return tx.financeSettings.update({
        where: { tenant_id: tenantId },
        data: { next_sales_order_number: { increment: 1 } },
      });
    });
    const orderNumber = `${settings.sales_order_prefix}${settings.next_sales_order_number - 1}`;

    // Calculate totals
    const itemsData = createDto.items.map((item) => {
      const quantity = new Prisma.Decimal(item.quantity);
      const unitPrice = new Prisma.Decimal(item.unit_price);
      const total = quantity.mul(unitPrice);
      return {
        tenant_id: tenantId,
        catalog_item_id: item.catalog_item_id,
        description: item.description,
        quantity: quantity,
        unit_price: unitPrice,
        tax_rate: new Prisma.Decimal(item.tax_rate || 20),
        total: total,
      };
    });

    const totalAmount = itemsData.reduce(
      (sum, item) => sum.add(item.total),
      new Prisma.Decimal(0),
    );

    const createdOrder = await this.prisma.salesOrder.create({
      data: {
        tenant_id: tenantId,
        order_number: orderNumber,
        customer_id: createDto.customer_id,
        vehicle_id: createDto.vehicle_id,
        notes: createDto.notes,
        status: SalesOrderStatus.DRAFT,
        total_amount: totalAmount,
        items: {
          create: itemsData,
        },
      },
      include: {
        items: true,
        customer: true,
        vehicle: true,
      },
    });

    return createdOrder;
  }

  async findAll(params: any) {
    const tenantId = await this.tenantContext.getTenantId();
    // If params is just a Prisma query object from QueryBuilder
    if (
      params &&
      (params.where || params.orderBy || params.skip !== undefined)
    ) {
      const [data, total] = await Promise.all([
        this.prisma.salesOrder.findMany({
          ...params,
          where: { ...(params.where ?? {}), tenant_id: tenantId },
          include: {
            customer: true,
            vehicle: true,
            items: true,
          },
        }),
        this.prisma.salesOrder.count({
          where: { ...(params.where ?? {}), tenant_id: tenantId },
        }),
      ]);
      return { data, total };
    }

    const status = params as SalesOrderStatus;
    return this.prisma.salesOrder.findMany({
      where: status ? { tenant_id: tenantId, status } : { tenant_id: tenantId },
      include: {
        customer: true,
        vehicle: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        items: {
          include: {
            catalog_item: true,
          },
        },
        customer: true,
        vehicle: true,
        invoice: { select: { id: true, invoice_number: true } },
      },
    });
    if (!order) throw new NotFoundException(`Sales Order ${id} not found`);
    return order;
  }

  async update(id: string, updateDto: UpdateSalesOrderDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const order = await this.findOne(id);

    // If updating items, recalculate total
    let itemsUpdate: any = undefined;
    let totalAmount = order.total_amount;

    if (updateDto.items) {
      // Delete existing items and recreate (simple approach for now)
      // In a real app, we might want to reconcile

      // This transaction logic should be inside a $transaction if we want atomicity for replace
      // For now, I'll just rely on the update data structure

      const newItemsData = updateDto.items.map((item) => {
        const quantity = new Prisma.Decimal(item.quantity);
        const unitPrice = new Prisma.Decimal(item.unit_price);
        const total = quantity.mul(unitPrice);
        return {
          tenant_id: tenantId,
          catalog_item_id: item.catalog_item_id,
          description: item.description,
          quantity: quantity,
          unit_price: unitPrice,
          tax_rate: new Prisma.Decimal(item.tax_rate || 20),
          total: total,
        };
      });

      totalAmount = newItemsData.reduce(
        (sum, item) => sum.add(item.total),
        new Prisma.Decimal(0),
      );

      itemsUpdate = {
        deleteMany: {},
        create: newItemsData,
      };
    }

    const updatedOrder = await this.prisma.salesOrder.update({
      where: { id },
      data: {
        customer_id: updateDto.customer_id,
        vehicle_id: updateDto.vehicle_id,
        notes: updateDto.notes,
        status: updateDto.status,
        total_amount: totalAmount, // Update total if items changed
        items: itemsUpdate,
      },
      include: { items: true },
    });

    return updatedOrder;
  }

  async createInvoiceFromOrder(orderId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    // Validate transaction date against lock period
    await this.financeService.validateTransactionDate(new Date());

    const order = await this.findOne(orderId);

    if (order.status === SalesOrderStatus.INVOICED) {
      throw new BadRequestException('Order is already invoiced');
    }

    // 1. Calculate Invoice Totals
    let totalNet = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);

    const invoiceItemsData = order.items.map((item) => {
      const net = item.total;
      const tax = net.mul(item.tax_rate).div(100);

      totalNet = totalNet.add(net);
      totalTax = totalTax.add(tax);

      return {
        tenant_id: tenantId,
        catalog_item_id: item.catalog_item_id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
        line_total: net,
        revenue_group_name: 'Sales', // Default for now
      };
    });

    const totalGross = totalNet.add(totalTax);

    // 2. Create Invoice in Transaction
    const invoice = await this.prisma.$transaction(async (tx) => {
      try {
        const invoice = await tx.invoice.create({
          data: {
            tenant_id: tenantId,
            customer_id: order.customer_id,
            vehicle_id: order.vehicle_id,
            sales_order_id: order.id,
            status: InvoiceStatus.DRAFT,
            due_date: new Date(new Date().setDate(new Date().getDate() + 14)), // Default 14 days
            total_net: totalNet,
            total_tax: totalTax,
            total_gross: totalGross,
            notes: order.notes,
            items: {
              create: invoiceItemsData,
            },
          },
        });

        return invoice;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new BadRequestException('Order already has an invoice');
        }
        throw error;
      }
    });

    return invoice;
  }

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const result = await this.prisma.salesOrder.deleteMany({
      where: {
        id,
        tenant_id: tenantId,
        status: SalesOrderStatus.DRAFT,
        invoice: null,
      },
    });

    if (result.count === 0) {
      throw new BadRequestException(
        'Sales order can only be deleted when it is DRAFT and has no invoice.',
      );
    }

    return { id };
  }
}

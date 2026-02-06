import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { SalesOrderStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { FinanceService } from '../../finance/finance.service';

@Injectable()
export class SalesOrderService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
  ) {}

  async create(createDto: CreateSalesOrderDto) {
    // Get and increment sales order number atomically
    const settings = await this.prisma.financeSettings.update({
      where: { id: 1 },
      data: { next_sales_order_number: { increment: 1 } },
    });
    const orderNumber = `${settings.sales_order_prefix}${settings.next_sales_order_number - 1}`;

    // Calculate totals
    const itemsData = createDto.items.map((item) => {
      const quantity = new Prisma.Decimal(item.quantity);
      const unitPrice = new Prisma.Decimal(item.unit_price);
      const total = quantity.mul(unitPrice);
      return {
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

    return this.prisma.salesOrder.create({
      data: {
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
  }

  async findAll(params: any) {
    // If params is just a Prisma query object from QueryBuilder
    if (
      params &&
      (params.where || params.orderBy || params.skip !== undefined)
    ) {
      const [data, total] = await Promise.all([
        this.prisma.salesOrder.findMany({
          ...params,
          include: {
            customer: true,
            vehicle: true,
            items: true,
          },
        }),
        this.prisma.salesOrder.count({ where: params.where }),
      ]);
      return { data, total };
    }

    const status = params as SalesOrderStatus;
    return this.prisma.salesOrder.findMany({
      where: status ? { status } : undefined,
      include: {
        customer: true,
        vehicle: true,
        items: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            catalog_item: true,
          },
        },
        customer: true,
        vehicle: true,
        invoice: true,
      },
    });
    if (!order) throw new NotFoundException(`Sales Order ${id} not found`);
    return order;
  }

  async update(id: string, updateDto: UpdateSalesOrderDto) {
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

    return this.prisma.salesOrder.update({
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
  }

  async createInvoiceFromOrder(orderId: string) {
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
        catalog_item_id: item.catalog_item_id,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        tax_rate: item.tax_rate,
        revenue_group_name: 'Sales', // Default for now
      };
    });

    const totalGross = totalNet.add(totalTax);

    // 2. Create Invoice and Update Order in Transaction
    return this.prisma.$transaction(async (tx) => {
      // Get and increment invoice number atomically
      const settings = await tx.financeSettings.update({
        where: { id: 1 },
        data: { next_invoice_number: { increment: 1 } },
      });
      const invoiceNumber = `${settings.invoice_prefix}${settings.next_invoice_number - 1}`;

      const invoice = await tx.invoice.create({
        data: {
          invoice_number: invoiceNumber, // Set the generated number
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

      await tx.salesOrder.update({
        where: { id: order.id },
        data: { status: SalesOrderStatus.INVOICED },
      });

      return invoice;
    });
  }

  async remove(id: string) {
    const order = await this.findOne(id);
    if (order.status !== SalesOrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT orders can be deleted');
    }
    return this.prisma.salesOrder.delete({
      where: { id },
    });
  }
}

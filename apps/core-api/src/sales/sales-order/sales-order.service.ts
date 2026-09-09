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
import { stripVehicleIdentityResolutionState } from '../../vehicle/vehicle-identity.util';
import {
  assertCatalogItemsBelongToTenant,
  assertCustomerBelongsToTenant,
  assertVehicleBelongsToTenant,
} from '../helpers/sales-tenant-validation.helpers';
import { buildInvoiceDueDate } from '../helpers/invoice-line-items.helpers';
import {
  findDefaultSalesOrders,
  findPaginatedSalesOrders,
  isSalesOrderFindManyArgs,
  type PublicSalesOrder,
} from '../helpers/sales-order-query.helpers';
import {
  assertSalesOrderStatusTransition,
  formatSalesOrderItem,
  persistSalesOrderUpdate,
  prepareReplacementItems,
  reconcileSalesOrderItems,
  sumSalesOrderItemTotals,
} from '../helpers/sales-order-update.helpers';

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

    if (createDto.customer_id) {
      await assertCustomerBelongsToTenant(
        this.prisma,
        createDto.customer_id,
        tenantId,
      );
    }

    if (createDto.vehicle_id) {
      await assertVehicleBelongsToTenant(
        this.prisma,
        createDto.vehicle_id,
        tenantId,
      );
    }

    const catalogItemIds = createDto.items
      .map((item) => item.catalog_item_id)
      .filter((id): id is string => typeof id === 'string');
    await assertCatalogItemsBelongToTenant(
      this.prisma,
      catalogItemIds,
      tenantId,
    );

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

    const itemsData = createDto.items.map((item) =>
      formatSalesOrderItem(tenantId, item),
    );
    const totalAmount = sumSalesOrderItemTotals(itemsData);

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

    return {
      ...createdOrder,
      vehicle: createdOrder.vehicle
        ? stripVehicleIdentityResolutionState(createdOrder.vehicle)
        : createdOrder.vehicle,
    };
  }

  async findAll(
    params?: Prisma.SalesOrderFindManyArgs | SalesOrderStatus,
  ): Promise<{
    data: PublicSalesOrder[];
    total: number;
  }> {
    const tenantId = await this.tenantContext.getTenantId();

    if (isSalesOrderFindManyArgs(params)) {
      return findPaginatedSalesOrders(this.prisma, tenantId, params);
    }

    const status = typeof params === 'string' ? params : undefined;
    return findDefaultSalesOrders(this.prisma, tenantId, status);
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
    return {
      ...order,
      vehicle: order.vehicle
        ? stripVehicleIdentityResolutionState(order.vehicle)
        : order.vehicle,
    };
  }

  async update(id: string, updateDto: UpdateSalesOrderDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const order = await this.findOne(id);

    if (updateDto.customer_id) {
      await assertCustomerBelongsToTenant(
        this.prisma,
        updateDto.customer_id,
        tenantId,
      );
    }

    if (updateDto.vehicle_id) {
      await assertVehicleBelongsToTenant(
        this.prisma,
        updateDto.vehicle_id,
        tenantId,
      );
    }

    const replacement = updateDto.items
      ? await prepareReplacementItems(this.prisma, tenantId, updateDto.items)
      : undefined;

    const nextStatus = updateDto.status;
    if (nextStatus !== undefined && nextStatus !== order.status) {
      assertSalesOrderStatusTransition(order.status, nextStatus);
    }

    const fieldData: Prisma.SalesOrderUncheckedUpdateManyInput = {
      customer_id: updateDto.customer_id,
      vehicle_id: updateDto.vehicle_id,
      notes: updateDto.notes,
      total_amount: replacement?.totalAmount ?? order.total_amount,
    };

    return this.prisma.$transaction(async (tx) => {
      await persistSalesOrderUpdate(tx, {
        id,
        tenantId,
        currentStatus: order.status,
        nextStatus,
        fieldData,
      });

      if (replacement) {
        await reconcileSalesOrderItems(tx, {
          salesOrderId: id,
          tenantId,
          items: replacement.items,
        });
      }

      const refreshed = await tx.salesOrder.findFirst({
        where: { id, tenant_id: tenantId },
        include: { items: true },
      });

      if (!refreshed) {
        throw new NotFoundException('Sales order not found');
      }

      return refreshed;
    });
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
            due_date: buildInvoiceDueDate(),
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

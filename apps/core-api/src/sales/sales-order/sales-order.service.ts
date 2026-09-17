import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto.js';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto.js';
import { SalesOrderStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { FinanceService } from '../../finance/finance.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../common/services/site-context.service.js';
import {
  assertActiveTargetSiteMembership,
  assertPersistedSiteId,
  lockSitesAndAssertActive,
} from '../../site/document-retarget.helpers.js';
import { stripVehicleIdentityResolutionState } from '../../vehicle/vehicle-identity.util.js';
import {
  assertCatalogItemsBelongToTenant,
  assertCustomerBelongsToTenant,
  assertVehicleBelongsToTenant,
} from '../helpers/sales-tenant-validation.helpers.js';
import { buildInvoiceDueDate } from '../helpers/invoice-line-items.helpers.js';
import {
  findDefaultSalesOrders,
  findPaginatedSalesOrders,
  isSalesOrderFindManyArgs,
  type PublicSalesOrder,
} from '../helpers/sales-order-query.helpers.js';
import {
  assertSalesOrderStatusTransition,
  formatSalesOrderItem,
  persistSalesOrderUpdate,
  prepareReplacementItems,
  reconcileSalesOrderItems,
  sumSalesOrderItemTotals,
} from '../helpers/sales-order-update.helpers.js';

@Injectable()
export class SalesOrderService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(FinanceService) private financeService: FinanceService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    @Inject(SiteContextService)
    private readonly siteContext: SiteContextService,
  ) {}

  async create(createDto: CreateSalesOrderDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();

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

    const itemsData = createDto.items.map((item) =>
      formatSalesOrderItem(tenantId, item),
    );
    const totalAmount = sumSalesOrderItemTotals(itemsData);

    // Get and increment sales order number atomically under site lock
    const currentYear = new Date().getFullYear();
    const createdOrder = await this.prisma.$transaction(async (tx) => {
      await lockSitesAndAssertActive(tx, tenantId, [siteId]);

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

      const settings = await tx.financeSettings.update({
        where: { tenant_id: tenantId },
        data: { next_sales_order_number: { increment: 1 } },
      });
      const orderNumber = `${settings.sales_order_prefix}${settings.next_sales_order_number - 1}`;

      return tx.salesOrder.create({
        data: {
          tenant_id: tenantId,
          site_id: siteId,
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
    const siteId = await this.siteContext.getSiteId();

    if (isSalesOrderFindManyArgs(params)) {
      return findPaginatedSalesOrders(this.prisma, tenantId, params, siteId);
    }

    const status = typeof params === 'string' ? params : undefined;
    return findDefaultSalesOrders(this.prisma, tenantId, status, siteId);
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const order = await this.prisma.salesOrder.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
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

    if (
      updateDto.expectedSiteId !== undefined &&
      order.site_id &&
      updateDto.expectedSiteId !== order.site_id
    ) {
      throw new ConflictException(
        'Sales order site changed concurrently. Please refresh.',
      );
    }

    const isRetargeting =
      updateDto.siteId !== undefined && updateDto.siteId !== order.site_id;

    if (isRetargeting) {
      if (order.status !== SalesOrderStatus.DRAFT) {
        throw new UnprocessableEntityException(
          'Sales order site can only be changed while in DRAFT status',
        );
      }

      await assertActiveTargetSiteMembership(
        this.prisma,
        this.tenantContext,
        tenantId,
        updateDto.siteId!,
      );
    }

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

    if (isRetargeting) {
      fieldData.site_id = updateDto.siteId;
    }

    const persistedSiteId = assertPersistedSiteId(
      order.site_id,
      'Sales order site ownership is required',
    );
    const statusChanging =
      nextStatus !== undefined && nextStatus !== order.status;

    return this.prisma.$transaction(async (tx) => {
      if (isRetargeting) {
        await lockSitesAndAssertActive(tx, tenantId, [
          persistedSiteId,
          updateDto.siteId!,
        ]);
      } else if (statusChanging) {
        await lockSitesAndAssertActive(tx, tenantId, [persistedSiteId]);
      }

      await persistSalesOrderUpdate(tx, {
        id,
        tenantId,
        currentStatus: order.status,
        nextStatus,
        fieldData,
        currentSiteId: persistedSiteId,
        isRetargeting,
      });

      if (replacement) {
        await reconcileSalesOrderItems(tx, {
          salesOrderId: id,
          tenantId,
          items: replacement.items,
        });
      }

      const refreshed = await tx.salesOrder.findFirst({
        where: { id, tenant_id: tenantId, site_id: persistedSiteId },
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

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceStatus, type Prisma } from '@prisma/client';
import type { z } from 'zod';
import { attachPickerlDue } from '../vehicle/pickerl/attach-pickerl-due.js';
import { CustomerService } from '../customer/customer.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildMcpKeysetPage, keysetCursorOf } from './mcp-audit-read.mapper.js';
import { listGrossTotal } from './mcp-invoice-read.mapper.js';
import {
  toMcpInspectionRow,
  toMcpOrderRow,
  type McpOrderCandidate,
} from './mcp-order-history.mapper.js';
import { McpDocumentReadService } from './mcp-document-read.service.js';
import {
  clampMcpPageSize,
  decodeMcpKeysetCursor,
  type McpKeysetCursor,
} from './mcp-output.util.js';
import type {
  getCustomerInputSchema,
  getVehicleHistoryInputSchema,
} from './mcp-tool-schemas.js';

type GetCustomerInput = z.infer<typeof getCustomerInputSchema>;
type GetVehicleHistoryInput = z.infer<typeof getVehicleHistoryInputSchema>;

/**
 * Orders are listed for exactly one owner. An unset owner must never fall back
 * to "all orders", because Prisma ignores an undefined filter field.
 */
type OrderScope = {
  tenantId: string;
  siteId: string;
} & ({ customerId: string } | { vehicleId: string });

type OrderPageInput = {
  orders_page_size?: number;
  orders_cursor?: string;
};

/** Inspections and documents on the vehicle history are the newest few. The full lists are paged elsewhere. */
const VEHICLE_HISTORY_INSPECTIONS = 10;
const VEHICLE_HISTORY_DOCUMENTS = 10;

const ORDER_VEHICLE_SELECT = {
  id: true,
  plate: true,
  make: true,
  model: true,
} as const;

function decodeCursorOrThrow(cursor: string): McpKeysetCursor {
  const decoded = decodeMcpKeysetCursor(cursor);
  if (!decoded) {
    throw new BadRequestException('orders_cursor is invalid');
  }
  return decoded;
}

/** Orders strictly older than the cursor, in newest-first order over (createdAt, id). */
function ordersOlderThan(cursor: McpKeysetCursor) {
  const at = new Date(cursor.at);
  return {
    OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }],
  };
}

function compareOrdersNewestFirst(
  left: McpOrderCandidate,
  right: McpOrderCandidate,
): number {
  const byTime = right.createdAt.getTime() - left.createdAt.getTime();
  if (byTime !== 0) {
    return byTime;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? 1 : -1;
}

/**
 * Read-only history tools for a customer and a vehicle. Orders, invoices and
 * documents are scoped to the session tenant and the active site (ADR-0022).
 * The customer's contact data and vehicles come from the customer service,
 * which applies the vehicle lot visibility rules.
 */
@Injectable()
export class McpOrderHistoryReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly siteContext: SiteContextService,
    private readonly tenantContext: TenantContextService,
    private readonly customerService: CustomerService,
    private readonly documentReads: McpDocumentReadService,
  ) {}

  /**
   * Contact data, vehicles, and a compact page of orders. The REST detail also
   * nests five full workshop orders, sales orders, and invoices. Those records
   * push the result past the 32 KB cap, so the MCP read drops them. Invoices
   * are listed with list_invoices.
   */
  async getCustomer(input: GetCustomerInput) {
    const { tenantId, siteId } = await this.scope();
    const [detail, orders] = await Promise.all([
      this.customerService.findOne(input.customer_id, {
        historyPage: 1,
        historyLimit: 1,
      }),
      this.orderPage(
        { tenantId, siteId, customerId: input.customer_id },
        input,
      ),
    ]);
    // The customer's own columns only, so a relation added to the REST detail cannot reach this result.
    return {
      id: detail.id,
      tenant_id: detail.tenant_id,
      type: detail.type,
      company_name: detail.company_name,
      first_name: detail.first_name,
      last_name: detail.last_name,
      email: detail.email,
      phone: detail.phone,
      vat_id: detail.vat_id,
      address_street: detail.address_street,
      address_city: detail.address_city,
      address_zip: detail.address_zip,
      address_country: detail.address_country,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      vehicles: detail.vehicles,
      orders,
    };
  }

  async getVehicleHistory(input: GetVehicleHistoryInput) {
    const { tenantId, siteId } = await this.scope();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: input.vehicle_id, tenant_id: tenantId },
      select: {
        id: true,
        make: true,
        model: true,
        year: true,
        plate: true,
        first_registration_date: true,
        inspection_records: {
          orderBy: [{ inspected_on: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            inspection_type: true,
            inspected_on: true,
            plaketten_valid_until_year: true,
            plaketten_valid_until_month: true,
            station_name: true,
          },
        },
      },
    });
    if (!vehicle) {
      throw new NotFoundException(
        `Vehicle with ID ${input.vehicle_id} not found`,
      );
    }

    const [orders, documents] = await Promise.all([
      this.orderPage({ tenantId, siteId, vehicleId: vehicle.id }, input),
      this.documentReads.listDocuments({
        entity_type: 'vehicle',
        entity_id: vehicle.id,
        pageSize: VEHICLE_HISTORY_DOCUMENTS,
      }),
    ]);

    const { inspection_records: inspections, ...identity } = vehicle;
    const { pickerl_due } = attachPickerlDue(
      { ...identity, inspection_records: inspections },
      new Date(),
    );
    return {
      vehicle: {
        id: identity.id,
        make: identity.make,
        model: identity.model,
        year: identity.year,
        plate: identity.plate,
      },
      pickerl_due,
      orders,
      inspections: {
        data: inspections
          .slice(0, VEHICLE_HISTORY_INSPECTIONS)
          .map(toMcpInspectionRow),
        meta: { total: inspections.length },
      },
      documents,
    };
  }

  private async scope(): Promise<{ tenantId: string; siteId: string }> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    return { tenantId, siteId };
  }

  /**
   * One newest-first page over workshop and sales orders together. Each table
   * contributes its own newest pageSize + 1 rows, so the merged page is exact.
   */
  private async orderPage(scope: OrderScope, input: OrderPageInput) {
    const pageSize = clampMcpPageSize(input.orders_page_size);
    const cursor = input.orders_cursor
      ? decodeCursorOrThrow(input.orders_cursor)
      : null;
    const ownerWhere =
      'customerId' in scope
        ? { customer_id: scope.customerId }
        : { vehicle_id: scope.vehicleId };
    const cursorWhere = cursor ? { AND: [ordersOlderThan(cursor)] } : {};

    const [workshopOrders, salesOrders] = await Promise.all([
      this.prisma.workshopOrder.findMany({
        where: {
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          ...ownerWhere,
          ...cursorWhere,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        select: {
          id: true,
          order_number: true,
          status: true,
          createdAt: true,
          vehicle: { select: ORDER_VEHICLE_SELECT },
        },
      }),
      this.prisma.salesOrder.findMany({
        where: {
          tenant_id: scope.tenantId,
          site_id: scope.siteId,
          ...ownerWhere,
          ...cursorWhere,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        select: {
          id: true,
          order_number: true,
          status: true,
          createdAt: true,
          vehicle: { select: ORDER_VEHICLE_SELECT },
        },
      }),
    ]);

    const candidates: McpOrderCandidate[] = [
      ...workshopOrders.map((order) => ({
        kind: 'workshop_order' as const,
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        createdAt: order.createdAt,
        vehicle: order.vehicle,
      })),
      ...salesOrders.map((order) => ({
        kind: 'sales_order' as const,
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        createdAt: order.createdAt,
        vehicle: order.vehicle,
      })),
    ]
      .sort(compareOrdersNewestFirst)
      .slice(0, pageSize + 1);

    const grossByOrderId = await this.grossTotalsByOrderId(
      scope,
      candidates.slice(0, pageSize),
    );
    return buildMcpKeysetPage({
      records: candidates,
      pageSize,
      cursorOf: (candidate) =>
        keysetCursorOf(candidate.createdAt, candidate.id),
      mapRow: (candidate) =>
        toMcpOrderRow(candidate, grossByOrderId.get(candidate.id) ?? null),
    });
  }

  /** Gross totals from the invoices linked to the page's orders, in one query. */
  private async grossTotalsByOrderId(
    scope: { tenantId: string; siteId: string },
    orders: readonly McpOrderCandidate[],
  ): Promise<Map<string, string>> {
    const workshopOrderIds = orders
      .filter((order) => order.kind === 'workshop_order')
      .map((order) => order.id);
    const salesOrderIds = orders
      .filter((order) => order.kind === 'sales_order')
      .map((order) => order.id);
    const totals = new Map<string, string>();
    if (workshopOrderIds.length === 0 && salesOrderIds.length === 0) {
      return totals;
    }

    const linkedBy: Prisma.InvoiceWhereInput[] = [];
    if (workshopOrderIds.length > 0) {
      linkedBy.push({ workshop_order_id: { in: workshopOrderIds } });
    }
    if (salesOrderIds.length > 0) {
      linkedBy.push({ sales_order_id: { in: salesOrderIds } });
    }
    const invoices = await this.prisma.invoice.findMany({
      where: {
        tenant_id: scope.tenantId,
        site_id: scope.siteId,
        OR: linkedBy,
      },
      select: {
        workshop_order_id: true,
        sales_order_id: true,
        status: true,
        total_gross: true,
        snapshot: true,
      },
    });
    for (const invoice of invoices) {
      // A draft is not billed yet, so its order shows no total until the invoice is committed.
      if (invoice.status === InvoiceStatus.DRAFT) {
        continue;
      }
      const gross = listGrossTotal(invoice);
      if (invoice.workshop_order_id) {
        totals.set(invoice.workshop_order_id, gross);
      }
      if (invoice.sales_order_id) {
        totals.set(invoice.sales_order_id, gross);
      }
    }
    return totals;
  }
}

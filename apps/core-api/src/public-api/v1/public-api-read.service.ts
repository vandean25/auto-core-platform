import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  PublicCustomerDto,
  PublicInvoiceDto,
  PublicListQueryDto,
  PublicPageMetaDto,
  PublicStockLevelDto,
  PublicVehicleDto,
  PublicWorkshopOrderDto,
} from './dto/public-api-read.dto.js';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export type PublicPage<T> = {
  data: T[];
  meta: PublicPageMetaDto;
};

type ListQuery = Pick<PublicListQueryDto, 'page' | 'pageSize' | 'q'>;

type CustomerRow = {
  id: string;
  type: string;
  company_name: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  vat_id: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  address_country: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type VehicleRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  vin: string | null;
  plate: string | null;
  hsn: string | null;
  tsn: string | null;
  engine_code: string | null;
  fuel_type: string | null;
  power_kw: number | null;
  mileage: number | null;
  color: string | null;
  first_registration_date: Date | null;
  customer_id: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type InvoiceRow = {
  id: string;
  invoice_number: string | null;
  status: string;
  tax_mode: string;
  date: Date;
  due_date: Date;
  currency: string | null;
  customer_id: string;
  vehicle_id: string | null;
  workshop_order_id: string | null;
  sales_order_id: string | null;
  site_id: string | null;
  total_net: Prisma.Decimal;
  total_tax: Prisma.Decimal;
  total_gross: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
};

type WorkshopOrderRow = {
  id: string;
  order_number: string;
  status: string;
  purpose: string;
  site_id: string | null;
  customer_id: string | null;
  vehicle_id: string;
  odometer: number;
  fuel_level: number;
  reported_issue: string | null;
  scheduled_start_at: Date | null;
  scheduled_end_at: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type StockRow = {
  id: string;
  site_id: string;
  quantity_on_hand: Prisma.Decimal;
  quantity_reserved: Prisma.Decimal;
  updatedAt: Date;
  catalog_item: { id: string; sku: string; name: string };
  location: { id: string; code: string; name: string };
};

const CUSTOMER_SELECT = {
  id: true,
  type: true,
  company_name: true,
  first_name: true,
  last_name: true,
  email: true,
  phone: true,
  vat_id: true,
  address_street: true,
  address_zip: true,
  address_city: true,
  address_country: true,
  createdAt: true,
  updatedAt: true,
} as const;

const VEHICLE_SELECT = {
  id: true,
  make: true,
  model: true,
  year: true,
  vin: true,
  plate: true,
  hsn: true,
  tsn: true,
  engine_code: true,
  fuel_type: true,
  power_kw: true,
  mileage: true,
  color: true,
  first_registration_date: true,
  customer_id: true,
  createdAt: true,
  updatedAt: true,
} as const;

const INVOICE_SELECT = {
  id: true,
  invoice_number: true,
  status: true,
  tax_mode: true,
  date: true,
  due_date: true,
  currency: true,
  customer_id: true,
  vehicle_id: true,
  workshop_order_id: true,
  sales_order_id: true,
  site_id: true,
  total_net: true,
  total_tax: true,
  total_gross: true,
  createdAt: true,
  updatedAt: true,
} as const;

const WORKSHOP_ORDER_SELECT = {
  id: true,
  order_number: true,
  status: true,
  purpose: true,
  site_id: true,
  customer_id: true,
  vehicle_id: true,
  odometer: true,
  fuel_level: true,
  reported_issue: true,
  scheduled_start_at: true,
  scheduled_end_at: true,
  createdAt: true,
  updatedAt: true,
} as const;

const STOCK_SELECT = {
  id: true,
  site_id: true,
  quantity_on_hand: true,
  quantity_reserved: true,
  updatedAt: true,
  catalog_item: { select: { id: true, sku: true, name: true } },
  location: { select: { id: true, code: true, name: true } },
} as const;

/**
 * Read-only data for tenant API keys (ADR-0026). Every query is scoped to the key's tenant. Site-owned
 * rows are scoped to the tenant's active sites, because a key is tenant-wide in v1. Responses are built
 * from explicit allowlists, so internal fields never leave the server.
 */
@Injectable()
export class PublicApiReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listCustomers(
    query: ListQuery,
  ): Promise<PublicPage<PublicCustomerDto>> {
    const tenantId = await this.tenantContext.getTenantId();
    const paging = resolvePaging(query);
    const q = normalizeSearch(query.q);
    const customerWhere: Prisma.CustomerWhereInput = {
      tenant_id: tenantId,
      ...(q
        ? {
            OR: [
              { first_name: { contains: q, mode: 'insensitive' } },
              { last_name: { contains: q, mode: 'insensitive' } },
              { company_name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q, mode: 'insensitive' } },
              { vat_id: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where: customerWhere,
        select: CUSTOMER_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: paging.skip,
        take: paging.take,
      }),
      this.prisma.customer.count({ where: customerWhere }),
    ]);

    return toPage(rows.map(toCustomerDto), total, paging);
  }

  async getCustomer(id: string): Promise<PublicCustomerDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const row = await this.prisma.customer.findFirst({
      where: { id, tenant_id: tenantId },
      select: CUSTOMER_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Customer not found.');
    }
    return toCustomerDto(row);
  }

  async listVehicles(query: ListQuery): Promise<PublicPage<PublicVehicleDto>> {
    const tenantId = await this.tenantContext.getTenantId();
    const paging = resolvePaging(query);
    const q = normalizeSearch(query.q);
    const vehicleWhere: Prisma.VehicleWhereInput = {
      tenant_id: tenantId,
      ...(q
        ? {
            OR: [
              { make: { contains: q, mode: 'insensitive' } },
              { model: { contains: q, mode: 'insensitive' } },
              { vin: { contains: q, mode: 'insensitive' } },
              { plate: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where: vehicleWhere,
        select: VEHICLE_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: paging.skip,
        take: paging.take,
      }),
      this.prisma.vehicle.count({ where: vehicleWhere }),
    ]);

    return toPage(rows.map(toVehicleDto), total, paging);
  }

  async getVehicle(id: string): Promise<PublicVehicleDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const row = await this.prisma.vehicle.findFirst({
      where: { id, tenant_id: tenantId },
      select: VEHICLE_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Vehicle not found.');
    }
    return toVehicleDto(row);
  }

  async listInvoices(query: ListQuery): Promise<PublicPage<PublicInvoiceDto>> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteIds = await this.activeSiteIds(tenantId);
    const paging = resolvePaging(query);
    const q = normalizeSearch(query.q);
    const invoiceWhere: Prisma.InvoiceWhereInput = {
      tenant_id: tenantId,
      AND: [
        { OR: [{ site_id: null }, { site_id: { in: siteIds } }] },
        ...(q
          ? [{ invoice_number: { contains: q, mode: 'insensitive' as const } }]
          : []),
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where: invoiceWhere,
        select: INVOICE_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: paging.skip,
        take: paging.take,
      }),
      this.prisma.invoice.count({ where: invoiceWhere }),
    ]);

    return toPage(rows.map(toInvoiceDto), total, paging);
  }

  async getInvoice(id: string): Promise<PublicInvoiceDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteIds = await this.activeSiteIds(tenantId);
    const row = await this.prisma.invoice.findFirst({
      where: {
        id,
        tenant_id: tenantId,
        AND: [{ OR: [{ site_id: null }, { site_id: { in: siteIds } }] }],
      },
      select: INVOICE_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Invoice not found.');
    }
    return toInvoiceDto(row);
  }

  async listWorkshopOrders(
    query: ListQuery,
  ): Promise<PublicPage<PublicWorkshopOrderDto>> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteIds = await this.activeSiteIds(tenantId);
    const paging = resolvePaging(query);
    const q = normalizeSearch(query.q);
    const workshopOrderWhere: Prisma.WorkshopOrderWhereInput = {
      tenant_id: tenantId,
      AND: [
        { OR: [{ site_id: null }, { site_id: { in: siteIds } }] },
        ...(q
          ? [{ order_number: { contains: q, mode: 'insensitive' as const } }]
          : []),
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.workshopOrder.findMany({
        where: workshopOrderWhere,
        select: WORKSHOP_ORDER_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: paging.skip,
        take: paging.take,
      }),
      this.prisma.workshopOrder.count({ where: workshopOrderWhere }),
    ]);

    return toPage(rows.map(toWorkshopOrderDto), total, paging);
  }

  async getWorkshopOrder(id: string): Promise<PublicWorkshopOrderDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteIds = await this.activeSiteIds(tenantId);
    const row = await this.prisma.workshopOrder.findFirst({
      where: {
        id,
        tenant_id: tenantId,
        AND: [{ OR: [{ site_id: null }, { site_id: { in: siteIds } }] }],
      },
      select: WORKSHOP_ORDER_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Workshop order not found.');
    }
    return toWorkshopOrderDto(row);
  }

  async listStockLevels(
    query: ListQuery,
  ): Promise<PublicPage<PublicStockLevelDto>> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteIds = await this.activeSiteIds(tenantId);
    const paging = resolvePaging(query);
    const q = normalizeSearch(query.q);
    const stockWhere: Prisma.InventoryStockWhereInput = {
      tenant_id: tenantId,
      site_id: { in: siteIds },
      location: { deletedAt: null },
      ...(q
        ? {
            catalog_item: {
              OR: [
                { sku: { contains: q, mode: 'insensitive' } },
                { name: { contains: q, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.inventoryStock.findMany({
        where: stockWhere,
        select: STOCK_SELECT,
        orderBy: [{ catalog_item: { sku: 'asc' } }, { id: 'asc' }],
        skip: paging.skip,
        take: paging.take,
      }),
      this.prisma.inventoryStock.count({ where: stockWhere }),
    ]);

    return toPage(rows.map(toStockLevelDto), total, paging);
  }

  private async activeSiteIds(tenantId: string): Promise<string[]> {
    const sites = await this.prisma.site.findMany({
      where: { tenant_id: tenantId, is_active: true },
      select: { id: true },
    });
    return sites.map((site) => site.id);
  }
}

function resolvePaging(query: ListQuery) {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

function toPage<T>(
  data: T[],
  total: number,
  paging: { page: number; pageSize: number },
): PublicPage<T> {
  return {
    data,
    meta: {
      total,
      page: paging.page,
      pageSize: paging.pageSize,
      pageCount: Math.ceil(total / paging.pageSize),
    },
  };
}

function normalizeSearch(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function toCustomerDto(row: CustomerRow): PublicCustomerDto {
  return {
    id: row.id,
    type: row.type,
    companyName: row.company_name,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    vatId: row.vat_id,
    address: {
      street: row.address_street,
      zip: row.address_zip,
      city: row.address_city,
      country: row.address_country,
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toVehicleDto(row: VehicleRow): PublicVehicleDto {
  return {
    id: row.id,
    make: row.make,
    model: row.model,
    year: row.year,
    vin: row.vin,
    plate: row.plate,
    hsn: row.hsn,
    tsn: row.tsn,
    engineCode: row.engine_code,
    fuelType: row.fuel_type,
    powerKw: row.power_kw,
    mileage: row.mileage,
    color: row.color,
    firstRegistrationDate: row.first_registration_date
      ? row.first_registration_date.toISOString().slice(0, 10)
      : null,
    customerId: row.customer_id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toInvoiceDto(row: InvoiceRow): PublicInvoiceDto {
  return {
    id: row.id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    taxMode: row.tax_mode,
    date: row.date,
    dueDate: row.due_date,
    currency: row.currency,
    customerId: row.customer_id,
    vehicleId: row.vehicle_id,
    workshopOrderId: row.workshop_order_id,
    salesOrderId: row.sales_order_id,
    siteId: row.site_id,
    totalNet: money(row.total_net),
    totalTax: money(row.total_tax),
    totalGross: money(row.total_gross),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toWorkshopOrderDto(row: WorkshopOrderRow): PublicWorkshopOrderDto {
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    purpose: row.purpose,
    siteId: row.site_id,
    customerId: row.customer_id,
    vehicleId: row.vehicle_id,
    odometer: row.odometer,
    fuelLevel: row.fuel_level,
    reportedIssue: row.reported_issue,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toStockLevelDto(row: StockRow): PublicStockLevelDto {
  return {
    id: row.id,
    catalogItemId: row.catalog_item.id,
    sku: row.catalog_item.sku,
    name: row.catalog_item.name,
    siteId: row.site_id,
    locationId: row.location.id,
    locationCode: row.location.code,
    locationName: row.location.name,
    quantityOnHand: row.quantity_on_hand.toFixed(3),
    quantityReserved: row.quantity_reserved.toFixed(3),
    quantityAvailable: row.quantity_on_hand
      .minus(row.quantity_reserved)
      .toFixed(3),
    updatedAt: row.updatedAt,
  };
}

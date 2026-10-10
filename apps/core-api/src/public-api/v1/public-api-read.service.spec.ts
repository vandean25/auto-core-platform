import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PublicApiReadService } from './public-api-read.service.js';

const TENANT_ID = 'tenant-a';
const ACTIVE_SITE_IDS = ['site-1', 'site-2'];
const NOW = new Date('2026-10-09T10:00:00.000Z');

function createHarness() {
  const prisma = {
    site: {
      findMany: jest.fn().mockResolvedValue(ACTIVE_SITE_IDS.map((id) => ({ id }))),
    },
    customer: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn() },
    vehicle: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn() },
    invoice: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn() },
    workshopOrder: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), findFirst: jest.fn() },
    inventoryStock: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  };
  const tenantContext = { getTenantId: jest.fn(async () => TENANT_ID) };
  const service = new PublicApiReadService(prisma as never, tenantContext as never);
  return { service, prisma };
}

function customerRow() {
  return {
    id: 'cust-1',
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Demo',
    last_name: 'Kunde',
    email: 'demo.kunde@example.test',
    phone: null,
    vat_id: null,
    address_street: 'Musterweg 1',
    address_zip: '1010',
    address_city: 'Wien',
    address_country: 'AT',
    createdAt: NOW,
    updatedAt: NOW,
    tenant_id: TENANT_ID,
    // Internal relation or config fields must never be serialised.
    tenant: { secret: 'x' },
  };
}

describe('PublicApiReadService', () => {
  describe('tenant and site scope', () => {
    it('reads the active sites of the key tenant before any site-owned query', async () => {
      const { service, prisma } = createHarness();

      await service.listStockLevels({});

      expect(prisma.site.findMany).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, is_active: true },
        select: { id: true },
      });
    });

    it('scopes every customer list and detail query to the key tenant', async () => {
      const { service, prisma } = createHarness();
      prisma.customer.findFirst.mockResolvedValue(null);

      await service.listCustomers({});
      await expect(service.getCustomer('cust-1')).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.customer.findMany.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ where: expect.objectContaining({ tenant_id: TENANT_ID }) }),
      );
      expect(prisma.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'cust-1', tenant_id: TENANT_ID } }),
      );
    });

    it('limits workshop order detail to active sites, so another site answers 404', async () => {
      const { service, prisma } = createHarness();
      prisma.workshopOrder.findFirst.mockResolvedValue(null);

      await expect(service.getWorkshopOrder('wo-1')).rejects.toBeInstanceOf(NotFoundException);

      const where = prisma.workshopOrder.findFirst.mock.calls[0]?.[0] as { where: unknown };
      expect(JSON.stringify(where.where)).toContain(
        JSON.stringify({ site_id: { in: ACTIVE_SITE_IDS } }).slice(1, -1),
      );
      expect(where.where).toEqual(
        expect.objectContaining({ id: 'wo-1', tenant_id: TENANT_ID }),
      );
    });

    it('applies the active-site filter to invoices and keeps tenant-level invoices without a site', async () => {
      const { service, prisma } = createHarness();

      await service.listInvoices({});

      const where = prisma.invoice.findMany.mock.calls[0]?.[0] as { where: unknown };
      expect(where.where).toEqual(
        expect.objectContaining({ tenant_id: TENANT_ID }),
      );
      expect(JSON.stringify(where.where)).toContain('"site_id":null');
      expect(JSON.stringify(where.where)).toContain(
        `"site_id":{"in":${JSON.stringify(ACTIVE_SITE_IDS)}}`,
      );
    });

    it('lists stock only for active sites and never for soft-deleted storage locations', async () => {
      const { service, prisma } = createHarness();

      await service.listStockLevels({});

      const args = prisma.inventoryStock.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
      expect(args.where).toEqual(
        expect.objectContaining({
          tenant_id: TENANT_ID,
          site_id: { in: ACTIVE_SITE_IDS },
          location: { deletedAt: null },
        }),
      );
    });
  });

  describe('response shapes', () => {
    it('serialises a customer to an explicit public shape with no internal fields', async () => {
      const { service, prisma } = createHarness();
      prisma.customer.findMany.mockResolvedValue([customerRow()]);
      prisma.customer.count.mockResolvedValue(1);

      const page = await service.listCustomers({ page: 1, pageSize: 25 });

      expect(Object.keys(page.data[0] ?? {}).sort()).toEqual(
        [
          'address',
          'companyName',
          'createdAt',
          'email',
          'firstName',
          'id',
          'lastName',
          'phone',
          'type',
          'updatedAt',
          'vatId',
        ].sort(),
      );
      expect(page.data[0]?.address).toEqual({
        street: 'Musterweg 1',
        zip: '1010',
        city: 'Wien',
        country: 'AT',
      });
      expect(page.meta).toEqual({ total: 1, page: 1, pageSize: 25, pageCount: 1 });
      expect(JSON.stringify(page)).not.toContain('tenant_id');
    });

    it('never exposes dealer-stock lot, status or cost fields on vehicles', async () => {
      const { service, prisma } = createHarness();
      prisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'veh-1',
          make: 'Demo',
          model: 'Model',
          year: 2020,
          vin: null,
          plate: 'W-DEMO 1',
          hsn: null,
          tsn: null,
          engine_code: null,
          fuel_type: null,
          power_kw: null,
          mileage: 1000,
          color: null,
          first_registration_date: new Date('2020-01-15T00:00:00.000Z'),
          customer_id: null,
          createdAt: NOW,
          updatedAt: NOW,
          stock_cost_basis: new Prisma.Decimal('9999.99'),
          stock_status: 'AVAILABLE',
          site_id: 'site-1',
          location_id: 'loc-1',
          inventory_role: 'USED',
          identity_keys: { secret: 'x' },
        },
      ]);
      prisma.vehicle.count.mockResolvedValue(1);

      const page = await service.listVehicles({});
      const keys = Object.keys(page.data[0] ?? {});

      for (const forbidden of [
        'stockCostBasis',
        'stockStatus',
        'siteId',
        'locationId',
        'inventoryRole',
        'identityKeys',
      ]) {
        expect(keys).not.toContain(forbidden);
      }
      expect(page.data[0]?.firstRegistrationDate).toBe('2020-01-15');
    });

    it('formats money as fixed-point strings, never floats', async () => {
      const { service, prisma } = createHarness();
      prisma.invoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          invoice_number: 'RE-2026-0001',
          status: 'FINALIZED',
          tax_mode: 'STANDARD',
          date: NOW,
          due_date: NOW,
          currency: 'EUR',
          customer_id: 'cust-1',
          vehicle_id: null,
          workshop_order_id: null,
          sales_order_id: null,
          site_id: 'site-1',
          total_net: new Prisma.Decimal('100'),
          total_tax: new Prisma.Decimal('20.5'),
          total_gross: new Prisma.Decimal('120.5'),
          pdf_storage_key: 'private/path.pdf',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ]);
      prisma.invoice.count.mockResolvedValue(1);

      const page = await service.listInvoices({});

      expect(page.data[0]).toEqual(
        expect.objectContaining({
          totalNet: '100.00',
          totalTax: '20.50',
          totalGross: '120.50',
        }),
      );
      expect(JSON.stringify(page)).not.toContain('pdf_storage_key');
      expect(JSON.stringify(page)).not.toContain('private/path.pdf');
    });

    it('reports available quantity as on-hand minus reserved', async () => {
      const { service, prisma } = createHarness();
      prisma.inventoryStock.findMany.mockResolvedValue([
        {
          id: 'stock-1',
          site_id: 'site-1',
          quantity_on_hand: new Prisma.Decimal('5'),
          quantity_reserved: new Prisma.Decimal('1.5'),
          updatedAt: NOW,
          catalog_item: { id: 'cat-1', sku: 'FILTER-DEMO-01', name: 'Demo filter' },
          location: { id: 'loc-1', code: 'A-01', name: 'Aisle A' },
        },
      ]);
      prisma.inventoryStock.count.mockResolvedValue(1);

      const page = await service.listStockLevels({});

      expect(page.data[0]).toEqual(
        expect.objectContaining({
          sku: 'FILTER-DEMO-01',
          quantityOnHand: '5.000',
          quantityReserved: '1.500',
          quantityAvailable: '3.500',
        }),
      );
    });
  });

  describe('pagination', () => {
    it('clamps the page size to 100 and computes skip and take from the page', async () => {
      const { service, prisma } = createHarness();

      await service.listCustomers({ page: 3, pageSize: 500 });

      expect(prisma.customer.findMany.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ skip: 200, take: 100 }),
      );
    });
  });
});

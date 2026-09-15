import { SiteContextService } from '../common/services/site-context.service.js';
import {
  InvoiceTaxMode,
  Prisma,
  VehicleInventoryRole,
  VehicleSaleStatus,
  VehicleStockStatus,
} from '@prisma/client';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { VehicleLedgerService } from './vehicle-ledger.service.js';
import { VehicleSaleService } from './vehicle-sale.service.js';

describe('VehicleSaleService', () => {
  const tenantId = 'tenant-1';
  const vehicleId = 'vehicle-1';
  const saleId = 'sale-1';
  const customerId = 'customer-1';
  let service: VehicleSaleService;
  let prisma: {
    vehicleSale: {
      findFirst: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
    vehicle: { findFirst: jest.Mock; updateMany: jest.Mock };
    customer: { findFirst: jest.Mock };
    workshopOrder: { count: jest.Mock };
    vehicleLedgerEntry: { findMany: jest.Mock };
    invoiceSequence: { upsert: jest.Mock };
    invoice: { create: jest.Mock; updateMany: jest.Mock };
    user: { findUnique: jest.Mock };
    tenantMember: { findFirst: jest.Mock };
    siteMembership: { findFirst: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let tenantContext: { getTenantId: jest.Mock; getAuthenticatedUser: jest.Mock };
  let siteContext: { getSiteId: jest.Mock };
  let ledger: { listForVehicle: jest.Mock; append: jest.Mock };

  beforeEach(() => {
    prisma = {
      vehicleSale: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      vehicle: { findFirst: jest.fn(), updateMany: jest.fn() },
      customer: { findFirst: jest.fn() },
      workshopOrder: { count: jest.fn() },
      vehicleLedgerEntry: { findMany: jest.fn() },
      invoiceSequence: { upsert: jest.fn() },
      invoice: { create: jest.fn(), updateMany: jest.fn() },
      user: { findUnique: jest.fn() },
      tenantMember: { findFirst: jest.fn() },
      siteMembership: { findFirst: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'site-1', is_active: true }]),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({ userId: 'fb-user-1' }),
    };
    siteContext = {
      getSiteId: jest.fn().mockResolvedValue('site-1'),
    };
    ledger = {
      listForVehicle: jest.fn().mockResolvedValue([]),
      append: jest.fn(),
    };
    service = new VehicleSaleService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
      ledger as unknown as VehicleLedgerService,
    );
  });

  it('does not expose identity resolution state from a sale detail vehicle', async () => {
    prisma.vehicleSale.findFirst.mockResolvedValue({
      id: saleId,
      vehicle_id: vehicleId,
      customer_id: customerId,
      sale_price: new Prisma.Decimal(100),
      vehicle: {
        id: vehicleId,
        identity_resolution_generation: 'generation-1',
        identity_resolution_token: 'token-1',
      },
      customer: { id: customerId },
      invoice: null,
    });

    const result = await service.findOne(saleId);

    expect(result.vehicle).not.toHaveProperty('identity_resolution_generation');
    expect(result.vehicle).not.toHaveProperty('identity_resolution_token');
  });

  it('does not expose identity resolution state from finalized sale vehicles', async () => {
    const vehicle = {
      id: vehicleId,
      make: 'Peugeot',
      model: '308',
      year: 2024,
      vin: 'VIN-1',
      plate: 'PL-1',
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: 'token-1',
      inventory_role: VehicleInventoryRole.USED,
      stock_status: VehicleStockStatus.IN_STOCK,
      reserved_for_customer_id: null,
    };
    const customer = {
      id: customerId,
      type: 'PRIVATE',
      company_name: null,
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: null,
      phone: null,
      vat_id: null,
      address_street: null,
      address_city: null,
      address_zip: null,
      address_country: null,
    };
    const sale = {
      id: saleId,
      vehicle_id: vehicleId,
      customer_id: customerId,
      status: VehicleSaleStatus.DRAFT,
      sale_price: new Prisma.Decimal(100),
      vehicle,
      customer,
    };
    prisma.vehicleSale.findFirst
      .mockResolvedValueOnce(sale)
      .mockResolvedValueOnce(sale);
    prisma.vehicle.findFirst.mockResolvedValue(vehicle);
    prisma.customer.findFirst.mockResolvedValue(customer);
    prisma.workshopOrder.count.mockResolvedValue(0);
    prisma.vehicleSale.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehicleLedgerEntry.findMany.mockResolvedValue([]);
    prisma.invoiceSequence.upsert.mockResolvedValue({ current: 1 });
    prisma.invoice.create.mockResolvedValue({
      id: 'invoice-1',
      invoice_number: 'RE-2026-0001',
      date: new Date('2026-08-29T12:00:00.000Z'),
      due_date: new Date('2026-09-12T12:00:00.000Z'),
      total_net: new Prisma.Decimal(100),
      total_tax: new Prisma.Decimal(0),
      total_gross: new Prisma.Decimal(100),
      notes: null,
      tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
      items: [
        {
          description: 'Vehicle',
          quantity: new Prisma.Decimal(1),
          unit_price: new Prisma.Decimal(100),
          tax_rate: new Prisma.Decimal(20),
          line_discount_type: null,
          line_discount_value: null,
          line_total: new Prisma.Decimal(100),
          revenue_group_name: 'Vehicle used (margin)',
        },
      ],
      customer,
      vehicle,
    });
    prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehicleSale.update.mockResolvedValue(sale);
    prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.finalize(saleId);

    expect(result.vehicle).not.toHaveProperty('identity_resolution_generation');
    expect(result.vehicle).not.toHaveProperty('identity_resolution_token');
    expect(result.invoice.vehicle).not.toHaveProperty(
      'identity_resolution_generation',
    );
    expect(result.invoice.vehicle).not.toHaveProperty(
      'identity_resolution_token',
    );
  });

  describe('updateDraft (retargeting)', () => {
    it('retargets vehicle sale when in DRAFT, caller has membership, and parked vehicle is on target site lot', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue({
        id: saleId,
        site_id: 'site-1',
        status: VehicleSaleStatus.DRAFT,
        vehicle_id: vehicleId,
        sale_price: new Prisma.Decimal(10000),
        vehicle: {
          id: vehicleId,
          location: { id: 'loc-2', site_id: 'site-2' },
        },
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      prisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-2' });
      prisma.$queryRaw.mockResolvedValue([
        { id: 'site-1', is_active: true },
        { id: 'site-2', is_active: true },
      ]);
      prisma.vehicleSale.updateMany.mockResolvedValue({ count: 1 });

      await service.updateDraft(saleId, {
        siteId: 'site-2',
        expectedSiteId: 'site-1',
      });

      expect(prisma.vehicleSale.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: saleId,
            tenant_id: tenantId,
            site_id: 'site-1',
            status: VehicleSaleStatus.DRAFT,
          }),
          data: expect.objectContaining({
            site_id: 'site-2',
          }),
        }),
      );
    });

    it('rejects retargeting if parked vehicle is on a lot that does not belong to target site with 422', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue({
        id: saleId,
        site_id: 'site-1',
        status: VehicleSaleStatus.DRAFT,
        vehicle_id: vehicleId,
        vehicle: {
          id: vehicleId,
          location: { id: 'loc-1', site_id: 'site-1' }, // still on site-1!
        },
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      prisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-2' });

      await expect(
        service.updateDraft(saleId, { siteId: 'site-2' }),
      ).rejects.toThrow(
        'Vehicle is parked on another site; move the vehicle before retargeting sale',
      );
    });

    it('rejects retargeting if caller lacks target site membership with 422', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue({
        id: saleId,
        site_id: 'site-1',
        status: VehicleSaleStatus.DRAFT,
        vehicle_id: vehicleId,
        vehicle: {
          id: vehicleId,
          location: { id: 'loc-2', site_id: 'site-2' },
        },
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      prisma.siteMembership.findFirst.mockResolvedValue(null);

      await expect(
        service.updateDraft(saleId, { siteId: 'site-2' }),
      ).rejects.toThrow('Active site membership required on target site');
    });

    it('rejects retargeting with 409 if expectedSiteId does not match current site', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue({
        id: saleId,
        site_id: 'site-1',
        status: VehicleSaleStatus.DRAFT,
        vehicle_id: vehicleId,
      });

      await expect(
        service.updateDraft(saleId, {
          siteId: 'site-2',
          expectedSiteId: 'stale-site',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
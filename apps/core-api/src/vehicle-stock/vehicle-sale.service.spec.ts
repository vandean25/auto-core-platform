import { SiteContextService } from '../site/site-context.service.js';
import {
  InvoiceTaxMode,
  Prisma,
  VehicleInventoryRole,
  VehicleSaleStatus,
  VehicleStockStatus,
} from '@prisma/client';
import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InvoiceSnapshotCommitService } from '../invoices/invoice-snapshot-commit.service.js';
import { VehicleLedgerService } from './vehicle-ledger.service.js';
import { VehicleSaleService } from './vehicle-sale.service.js';
import { AuditLogAction } from '@prisma/client';
import { AuditService } from '../audit/audit.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';

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
    user: { findUnique: jest.Mock; findFirst: jest.Mock };
    tenantMember: { findFirst: jest.Mock };
    siteMembership: { findFirst: jest.Mock };
    site: { findFirst: jest.Mock };
    financeSettings: { upsert: jest.Mock; update: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let tenantContext: {
    getTenantId: jest.Mock;
    getAuthenticatedUser: jest.Mock;
  };
  let siteContext: {
    getSiteId: jest.Mock;
    listAuthorizedSiteIds: jest.Mock;
  };
  let ledger: { listForVehicle: jest.Mock; append: jest.Mock };
  let snapshotCommit: {
    lockCommitmentContext: jest.Mock;
    lockInvoiceRow: jest.Mock;
    prepareV2Snapshot: jest.Mock;
    persistV2Snapshot: jest.Mock;
  };
  let auditService: { recordTenantMutation: jest.Mock };
  let requestContext: { getSource: jest.Mock };

  beforeEach(() => {
    prisma = {
      vehicleSale: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
      },
      vehicle: { findFirst: jest.fn(), updateMany: jest.fn() },
      vehiclePurchase: { findFirst: jest.fn() },
      customer: { findFirst: jest.fn() },
      workshopOrder: { count: jest.fn() },
      vehicleLedgerEntry: { findMany: jest.fn() },
      invoiceSequence: { upsert: jest.fn() },
      invoice: { create: jest.fn(), updateMany: jest.fn() },
      user: { findUnique: jest.fn(), findFirst: jest.fn() },
      tenantMember: { findFirst: jest.fn() },
      siteMembership: { findFirst: jest.fn() },
      site: { findFirst: jest.fn() },
      financeSettings: {
        upsert: jest.fn(),
        update: jest.fn().mockResolvedValue({ next_vehicle_sale_number: 2 }),
      },
      $queryRaw: jest
        .fn()
        .mockResolvedValue([{ id: 'site-1', is_active: true }]),
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
      listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
    };
    ledger = {
      listForVehicle: jest.fn().mockResolvedValue([]),
      append: jest.fn(),
    };
    snapshotCommit = {
      lockCommitmentContext: jest.fn().mockImplementation(async () => {
        await prisma.$queryRaw`SELECT id FROM sites FOR UPDATE`;
        return {
          tenantId,
          ownership: { siteId: 'site-1', legalEntityId: 'le-1' },
        };
      }),
      lockInvoiceRow: jest.fn().mockResolvedValue(undefined),
      prepareV2Snapshot: jest.fn().mockResolvedValue({
        snapshot: { schema_version: 2 },
        ownership: { siteId: 'site-1', legalEntityId: 'le-1' },
        dueDate: new Date('2026-09-12T12:00:00.000Z'),
        supplyFrom: new Date('2026-08-29T12:00:00.000Z'),
        supplyTo: new Date('2026-08-29T12:00:00.000Z'),
      }),
      persistV2Snapshot: jest.fn().mockResolvedValue(undefined),
    };
    auditService = { recordTenantMutation: jest.fn() };
    requestContext = { getSource: jest.fn().mockReturnValue('API') };
    service = new VehicleSaleService(
      prisma as unknown as PrismaService,
      tenantContext as unknown as TenantContextService,
      siteContext as unknown as SiteContextService,
      ledger as unknown as VehicleLedgerService,
      snapshotCommit as unknown as InvoiceSnapshotCommitService,
      auditService as unknown as AuditService,
      requestContext as unknown as RequestContextService,
    );
  });

  describe('Gewaehrleistung sale facts', () => {
    it('scopes the related vehicle when updating a draft sale', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({});
      prisma.vehicleSale.findFirst.mockResolvedValue({
        id: saleId,
        tenant_id: tenantId,
        site_id: 'site-1',
        status: VehicleSaleStatus.DRAFT,
        vehicle_id: vehicleId,
        vehicle: { first_registration_date: new Date('2020-01-01'), location: { site_id: 'site-1' } },
      });
      prisma.vehicleSale.updateMany.mockResolvedValue({ count: 1 });
      prisma.vehicleSale.findFirst.mockResolvedValueOnce({
        id: saleId,
        tenant_id: tenantId,
        site_id: 'site-1',
        status: VehicleSaleStatus.DRAFT,
        vehicle_id: vehicleId,
        vehicle: { first_registration_date: new Date('2020-01-01'), location: { site_id: 'site-1' } },
      }).mockResolvedValueOnce({ id: saleId, vehicle_id: vehicleId, sale_price: 100 });

      await service.updateDraft(saleId, { gewaehrleistung_note: 'note' });

      expect(prisma.vehicleSale.findFirst.mock.calls[0][0].where.vehicle).toEqual({
        is: { tenant_id: tenantId, site_id: { in: ['site-1'] } },
      });
    });

    it('scopes the related vehicle when correcting an invoiced sale', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({});
      prisma.vehicleSale.findFirst.mockResolvedValue({
        id: saleId,
        tenant_id: tenantId,
        site_id: 'site-1',
        status: VehicleSaleStatus.INVOICED,
        vehicle_id: vehicleId,
        vehicle: { first_registration_date: new Date('2020-01-01') },
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
      });
      prisma.vehicleSale.updateMany.mockResolvedValue({ count: 1 });
      prisma.vehicleSale.update.mockResolvedValue({});

      await service.correctGewaehrleistungSnapshot(saleId, {
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
        reason: 'Corrected contract facts',
      });

      expect(prisma.vehicleSale.findFirst.mock.calls[0][0].where.vehicle).toEqual({
        is: { tenant_id: tenantId, site_id: { in: ['site-1'] } },
      });
    });

    it.each([
      ['PRIVATE', true],
      ['COMPANY', false],
    ])(
      'defaults the captured consumer fact from tenant-owned customer type %s',
      async (customerType, isConsumer) => {
        const buyer = { id: customerId, type: customerType };
        prisma.customer.findFirst.mockResolvedValue(buyer);
        prisma.vehicle.findFirst
          .mockResolvedValueOnce({
            id: vehicleId,
            inventory_role: VehicleInventoryRole.USED,
            stock_status: VehicleStockStatus.IN_STOCK,
            first_registration_date: new Date('2020-01-01T00:00:00.000Z'),
            location: { site_id: 'site-1' },
          })
          .mockResolvedValueOnce({
            id: vehicleId,
            location: { site_id: 'site-1' },
          });
        prisma.workshopOrder.count.mockResolvedValue(0);
        prisma.financeSettings.upsert.mockResolvedValue({});
        prisma.$transaction.mockImplementation(async (callback) =>
          callback(prisma),
        );
        prisma.vehicleSale.create.mockResolvedValue({
          id: saleId,
          buyer_is_consumer: true,
        });

        await service.create({
          vehicle_id: vehicleId,
          customer_id: customerId,
          sale_price: 100,
          contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
          handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
        });

        expect(prisma.vehicleSale.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              buyer_is_consumer: isConsumer,
              gewaehrleistung_ends_on: isConsumer
                ? new Date('2028-10-08T00:00:00.000Z')
                : null,
            }),
          }),
        );
      },
    );

    it.each([
      [
        'missing registration',
        null,
        'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
      ],
      [
        'vehicle too new',
        new Date('2025-10-08T00:00:00.000Z'),
        'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
      ],
      [
        'non-consumer buyer',
        new Date('2020-01-01T00:00:00.000Z'),
        'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
      ],
    ])(
      'rejects invalid shortening for %s with a stable code and German message',
      async (_caseName, firstRegistrationDate, code) => {
        prisma.vehicleSale.findFirst.mockResolvedValue({
          id: saleId,
          site_id: 'site-1',
          status: VehicleSaleStatus.DRAFT,
          vehicle_id: vehicleId,
          customer_id: customerId,
          buyer_is_consumer:
            code !== 'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
          gewaehrleistung_shortened_negotiated: false,
          vehicle: { first_registration_date: firstRegistrationDate },
        });
        prisma.vehicleSale.updateMany.mockResolvedValue({ count: 1 });
        prisma.vehicleSale.findFirst.mockResolvedValueOnce({
          id: saleId,
          site_id: 'site-1',
          status: VehicleSaleStatus.DRAFT,
          vehicle_id: vehicleId,
          customer_id: customerId,
          buyer_is_consumer:
            code !== 'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
          gewaehrleistung_shortened_negotiated: false,
          vehicle: { first_registration_date: firstRegistrationDate },
        });

        await expect(
          service.updateDraft(saleId, {
            contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
            handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
            buyer_is_consumer:
              code !== 'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
            gewaehrleistung_shortened_negotiated: true,
          }),
        ).rejects.toMatchObject({
          status: 422,
          response: expect.objectContaining({
            code,
            message: expect.stringMatching(/[äöüÄÖÜß]/),
          }),
        });
        expect(prisma.vehicleSale.updateMany).not.toHaveBeenCalled();
      },
    );

    it('refreshes the snapshot when a draft handover date changes', async () => {
      const sale = {
        id: saleId,
        site_id: 'site-1',
        status: VehicleSaleStatus.DRAFT,
        vehicle_id: vehicleId,
        customer_id: customerId,
        sale_price: new Prisma.Decimal(100),
        contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
        handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
        gewaehrleistung_note: null,
        vehicle: {
          first_registration_date: new Date('2020-01-01T00:00:00.000Z'),
        },
      };
      prisma.vehicleSale.findFirst
        .mockResolvedValueOnce(sale)
        .mockResolvedValueOnce({
          ...sale,
          handed_over_at: new Date('2026-10-10T00:00:00.000Z'),
          gewaehrleistung_ends_on: new Date('2028-10-10T00:00:00.000Z'),
        });
      prisma.vehicleSale.updateMany.mockResolvedValue({ count: 1 });

      await service.updateDraft(saleId, {
        handed_over_at: new Date('2026-10-10T00:00:00.000Z'),
      });

      expect(prisma.vehicleSale.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            handed_over_at: new Date('2026-10-10T00:00:00.000Z'),
            gewaehrleistung_ends_on: new Date('2028-10-10T00:00:00.000Z'),
          }),
        }),
      );
    });

    it('rejects ordinary patches after invoicing without mutating the sale snapshot', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue({
        id: saleId,
        site_id: 'site-1',
        status: VehicleSaleStatus.INVOICED,
        vehicle_id: vehicleId,
        buyer_is_consumer: true,
        gewaehrleistung_ends_on: new Date('2028-10-08T00:00:00.000Z'),
      });

      await expect(
        service.updateDraft(saleId, { handed_over_at: new Date() }),
      ).rejects.toMatchObject({ status: 422 });
      expect(prisma.vehicleSale.updateMany).not.toHaveBeenCalled();
    });

    it('audits an explicit invoiced correction with actor, source, before, after, and reason', async () => {
      const before = {
        id: saleId,
        tenant_id: tenantId,
        site_id: 'site-1',
        status: VehicleSaleStatus.INVOICED,
        vehicle_id: vehicleId,
        customer_id: customerId,
        sale_price: new Prisma.Decimal(100),
        contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
        handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
        gewaehrleistung_note: null,
        gewaehrleistung_ends_on: new Date('2028-10-08T00:00:00.000Z'),
        presumption_ends_on: new Date('2027-10-08T00:00:00.000Z'),
        gewaehrleistung_rule_version: 'at-used-vehicle-vgg-2026-10-v2',
        vehicle: {
          first_registration_date: new Date('2020-01-01T00:00:00.000Z'),
        },
      };
      prisma.vehicleSale.findFirst
        .mockResolvedValueOnce(before)
        .mockResolvedValueOnce({
          ...before,
          handed_over_at: new Date('2026-10-10T00:00:00.000Z'),
        });
      prisma.vehicleSale.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findFirst.mockResolvedValue({ id: 'user-db-1' });

      await service.correctGewaehrleistungSnapshot(saleId, {
        reason: 'Erfassungsfehler korrigiert',
        contract_concluded_at: before.contract_concluded_at,
        handed_over_at: new Date('2026-10-10T00:00:00.000Z'),
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
        gewaehrleistung_note: null,
      });

      expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'VehicleSale',
          entityId: saleId,
          action: AuditLogAction.UPDATE,
          actorUserId: 'user-db-1',
          source: 'API',
          before: expect.objectContaining({ snapshot: expect.any(Object) }),
          after: expect.objectContaining({
            reason: 'Erfassungsfehler korrigiert',
            snapshot: expect.any(Object),
          }),
        }),
        prisma,
      );
    });

    it('conflicts on stale correction snapshots without writing a second audit row', async () => {
      const staleHandover = new Date('2026-10-08T00:00:00.000Z');
      const sale = {
        id: saleId,
        tenant_id: tenantId,
        site_id: 'site-1',
        status: VehicleSaleStatus.INVOICED,
        vehicle_id: vehicleId,
        customer_id: customerId,
        sale_price: new Prisma.Decimal(100),
        contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
        handed_over_at: staleHandover,
        buyer_is_consumer: true,
        gewaehrleistung_shortened_negotiated: false,
        gewaehrleistung_note: null,
        gewaehrleistung_ends_on: new Date('2028-10-08T00:00:00.000Z'),
        presumption_ends_on: new Date('2027-10-08T00:00:00.000Z'),
        gewaehrleistung_rule_version: 'at-used-vehicle-vgg-2026-10-v2',
        vehicle: {
          first_registration_date: new Date('2020-01-01T00:00:00.000Z'),
        },
      };
      prisma.vehicleSale.findFirst.mockResolvedValue(sale);
      prisma.vehicleSale.updateMany.mockImplementation(async ({ where }) => ({
        count: where.handed_over_at === staleHandover ? 0 : 1,
      }));

      await expect(
        service.correctGewaehrleistungSnapshot(saleId, {
          reason: 'Concurrent correction',
          handed_over_at: new Date('2026-10-10T00:00:00.000Z'),
          buyer_is_consumer: true,
          gewaehrleistung_shortened_negotiated: false,
        }),
      ).rejects.toMatchObject({ status: 409 });

      expect(prisma.vehicleSale.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            contract_concluded_at: sale.contract_concluded_at,
            handed_over_at: staleHandover,
            buyer_is_consumer: true,
            gewaehrleistung_shortened_negotiated: false,
            gewaehrleistung_note: null,
            gewaehrleistung_ends_on: sale.gewaehrleistung_ends_on,
            presumption_ends_on: sale.presumption_ends_on,
            gewaehrleistung_rule_version:
              sale.gewaehrleistung_rule_version,
          }),
        }),
      );
      expect(auditService.recordTenantMutation).not.toHaveBeenCalled();
    });
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

  it('preserves finalized-sale privacy and lock order', async () => {
    const stockReceivedAt = new Date();
    stockReceivedAt.setDate(stockReceivedAt.getDate() - 30);
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
      stock_received_at: stockReceivedAt,
      first_registration_date: new Date('2020-01-01T00:00:00.000Z'),
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
      site_id: 'site-1',
      vehicle_id: vehicleId,
      customer_id: customerId,
      status: VehicleSaleStatus.DRAFT,
      sale_price: new Prisma.Decimal(100),
      contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
      handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
      buyer_is_consumer: true,
      gewaehrleistung_shortened_negotiated: true,
      gewaehrleistung_ends_on: new Date('2028-10-08T00:00:00.000Z'),
      presumption_ends_on: new Date('2027-10-08T00:00:00.000Z'),
      gewaehrleistung_rule_version: 'stale-rule-version',
      vehicle,
      customer,
    };
    prisma.vehicleSale.findFirst
      .mockResolvedValueOnce(sale)
      .mockResolvedValueOnce(sale)
      .mockResolvedValueOnce(sale);
    prisma.vehicle.findFirst.mockResolvedValue(vehicle);
    prisma.customer.findFirst.mockResolvedValue(customer);
    prisma.workshopOrder.count.mockResolvedValue(0);
    prisma.vehicleSale.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehicleLedgerEntry.findMany.mockResolvedValue([]);
    prisma.invoiceSequence.upsert.mockResolvedValue({ current: 1 });
    prisma.site.findFirst.mockResolvedValue({
      id: 'site-1',
      legal_entity_id: 'le-1',
    });
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
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'site-1', is_active: true }]);

    const result = await service.finalize(saleId);

    expect(result.vehicle).not.toHaveProperty('identity_resolution_generation');
    expect(result.vehicle).not.toHaveProperty('identity_resolution_token');
    expect(result.invoice.vehicle).not.toHaveProperty(
      'identity_resolution_generation',
    );
    expect(result.invoice.vehicle).not.toHaveProperty(
      'identity_resolution_token',
    );
    expect(result.invoice).not.toHaveProperty('snapshot');
    expect(
      snapshotCommit.lockCommitmentContext.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.$queryRaw.mock.invocationCallOrder[0]);
    expect(prisma.invoice.create.mock.invocationCallOrder[0]).toBeLessThan(
      snapshotCommit.lockInvoiceRow.mock.invocationCallOrder[0],
    );
    expect(snapshotCommit.lockInvoiceRow).toHaveBeenCalledWith(
      prisma,
      tenantId,
      'invoice-1',
    );
    expect(
      snapshotCommit.lockInvoiceRow.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.invoiceSequence.upsert.mock.invocationCallOrder[0]);
    expect(
      snapshotCommit.prepareV2Snapshot.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.invoiceSequence.upsert.mock.invocationCallOrder[0]);
    expect(snapshotCommit.prepareV2Snapshot).toHaveBeenCalledWith(
      expect.objectContaining({ lockInvoiceRow: false }),
    );
    expect(prisma.vehicleLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          posting_date: { gte: stockReceivedAt },
          vehicle: { is: { tenant_id: tenantId, site_id: 'site-1' } },
        }),
      }),
    );
    expect(prisma.vehicleSale.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ days_to_sell_snapshot: 30 }),
      }),
    );
    expect(prisma.vehicleSale.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gewaehrleistung_ends_on: new Date('2027-10-08T00:00:00.000Z'),
          presumption_ends_on: new Date('2027-10-08T00:00:00.000Z'),
          gewaehrleistung_rule_version: 'at-used-vehicle-vgg-2026-10-v2',
        }),
      }),
    );
    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          first_registration_date: vehicle.first_registration_date,
        }),
      }),
    );
  });

  it('rejects finalization when a newly corrected registration date invalidates shortening', async () => {
    const sale = {
      id: saleId,
      site_id: 'site-1',
      vehicle_id: vehicleId,
      customer_id: customerId,
      status: VehicleSaleStatus.DRAFT,
      sale_price: new Prisma.Decimal(100),
      contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
      handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
      buyer_is_consumer: true,
      gewaehrleistung_shortened_negotiated: true,
      vehicle: { first_registration_date: new Date('2026-01-01T00:00:00.000Z') },
      customer: { id: customerId },
    };
    prisma.vehicleSale.findFirst.mockResolvedValue(sale);
    prisma.vehicle.findFirst.mockResolvedValue({
      inventory_role: VehicleInventoryRole.USED,
      stock_status: VehicleStockStatus.IN_STOCK,
      reserved_for_customer_id: null,
    });
    prisma.customer.findFirst.mockResolvedValue({ id: customerId });
    prisma.workshopOrder.count.mockResolvedValue(0);
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'site-1', is_active: true }]);

    await expect(service.finalize(saleId)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );

    expect(prisma.invoice.create).not.toHaveBeenCalled();
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

    it('refuses to retarget a sale with a trade-in attached, because the trade-in purchase stays at the old site', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue({
        id: saleId,
        site_id: 'site-1',
        status: VehicleSaleStatus.DRAFT,
        vehicle_id: vehicleId,
        customer_id: 'buyer-1',
        sale_price: new Prisma.Decimal(10000),
        trade_in_purchase_id: 'purchase-trade-in',
        vehicle: {
          id: vehicleId,
          location: { id: 'loc-2', site_id: 'site-2' },
        },
      });
      prisma.vehiclePurchase.findFirst.mockResolvedValue({
        id: 'purchase-trade-in',
        purchase_price: new Prisma.Decimal(3000),
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
      prisma.tenantMember.findFirst.mockResolvedValue({ id: 'tm-1' });
      prisma.siteMembership.findFirst.mockResolvedValue({ id: 'sm-2' });

      await expect(
        service.updateDraft(saleId, {
          siteId: 'site-2',
          expectedSiteId: 'site-1',
        }),
      ).rejects.toThrow(
        'Remove the trade-in before moving this sale to another site',
      );
      expect(prisma.vehicleSale.updateMany).not.toHaveBeenCalled();
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

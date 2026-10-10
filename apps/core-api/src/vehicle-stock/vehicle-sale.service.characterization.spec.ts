import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AuditLogAction,
  Prisma,
  VehicleAcquisitionKind,
  VehicleInventoryRole,
  VehiclePurchaseSellerType,
  VehiclePurchaseStatus,
  VehicleSaleStatus,
  VehicleStockStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { InvoiceSnapshotCommitService } from '../invoices/invoice-snapshot-commit.service.js';
import { VehicleLedgerService } from './vehicle-ledger.service.js';
import { VehicleSaleService } from './vehicle-sale.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import type { CreateVehicleSaleDto } from './dto/create-vehicle-sale.dto.js';
import type { PatchVehicleSaleDto } from './dto/patch-vehicle-sale.dto.js';
import type { CorrectGewaehrleistungSnapshotDto } from './dto/correct-gewaehrleistung-snapshot.dto.js';

/**
 * Characterizes the public sale flows (create, draft update, correction, finalize) before and
 * after the service is split. Assertions name the guard order, error text and persisted writes,
 * so a refactor that changes any of them fails here.
 */
describe('VehicleSaleService characterization', () => {
  const tenantId = 'tenant-1';
  const vehicleId = 'vehicle-1';
  const saleId = 'sale-1';
  const customerId = 'customer-1';
  const year = new Date().getFullYear();

  const makePrisma = () => ({
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
    user: { findFirst: jest.fn() },
    financeSettings: { upsert: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  });

  let service: VehicleSaleService;
  let prisma: ReturnType<typeof makePrisma>;
  let ledger: { listForVehicle: jest.Mock; append: jest.Mock };
  let auditService: { recordTenantMutation: jest.Mock };
  let snapshotCommit: Record<string, jest.Mock>;

  /** Resolves with the error a rejected call throws, and fails the test when the call succeeds. */
  const rejectionOf = (work: Promise<unknown>): Promise<unknown> =>
    work.then(
      () => {
        throw new Error('expected the call to reject');
      },
      (error: unknown) => error,
    );

  const vehicleFixture = (overrides: Record<string, unknown> = {}) => ({
    id: vehicleId,
    make: 'Peugeot',
    model: '308',
    year: 2024,
    vin: 'VIN-1',
    inventory_role: VehicleInventoryRole.USED,
    stock_status: VehicleStockStatus.IN_STOCK,
    stock_received_at: new Date('2026-09-01T00:00:00.000Z'),
    first_registration_date: new Date('2020-01-01T00:00:00.000Z'),
    reserved_for_customer_id: null,
    location: { site_id: 'site-1' },
    ...overrides,
  });

  const customerFixture = () => ({
    id: customerId,
    type: 'PRIVATE',
    first_name: 'Ada',
    last_name: 'Lovelace',
  });

  const saleFixture = (overrides: Record<string, unknown> = {}) => ({
    id: saleId,
    tenant_id: tenantId,
    site_id: 'site-1',
    vehicle_id: vehicleId,
    customer_id: customerId,
    status: VehicleSaleStatus.DRAFT,
    sale_price: new Prisma.Decimal(10000),
    trade_in_purchase_id: null,
    contract_concluded_at: new Date('2026-10-02T00:00:00.000Z'),
    handed_over_at: new Date('2026-10-08T00:00:00.000Z'),
    buyer_is_consumer: true,
    gewaehrleistung_shortened_negotiated: false,
    gewaehrleistung_note: null,
    vehicle: vehicleFixture(),
    customer: customerFixture(),
    ...overrides,
  });

  const tradeInFixture = (overrides: Record<string, unknown> = {}) => ({
    id: 'purchase-1',
    tenant_id: tenantId,
    site_id: 'site-1',
    status: VehiclePurchaseStatus.RECEIVED,
    acquisition_kind: VehicleAcquisitionKind.TRADE_IN,
    seller_type: VehiclePurchaseSellerType.CUSTOMER,
    customer_id: customerId,
    vin: 'TRADE-VIN-1',
    make: 'Skoda',
    model: 'Octavia',
    year: 2019,
    first_registration_date: new Date('2019-03-01T00:00:00.000Z'),
    purchase_price: new Prisma.Decimal(2000),
    ...overrides,
  });

  const createDto = (overrides: Record<string, unknown> = {}) =>
    ({
      vehicle_id: vehicleId,
      customer_id: customerId,
      sale_price: 10000,
      ...overrides,
    }) as unknown as CreateVehicleSaleDto;

  /**
   * Primes every write the finalize transaction makes. The sale is read three times: the initial
   * read, the locked draft read, and the posted read after the guarded status update.
   */
  const primeFinalize = (
    sale: ReturnType<typeof saleFixture>,
    options: {
      purchase?: ReturnType<typeof tradeInFixture> | null;
      stockGuardCount?: number;
      invoiceNumberCount?: number;
    } = {},
  ) => {
    prisma.vehicleSale.findFirst
      .mockResolvedValueOnce(sale)
      .mockResolvedValueOnce(sale)
      .mockResolvedValueOnce(sale);
    prisma.vehicle.findFirst.mockResolvedValue(sale.vehicle);
    prisma.customer.findFirst.mockResolvedValue(sale.customer);
    prisma.workshopOrder.count.mockResolvedValue(0);
    prisma.vehicleLedgerEntry.findMany.mockResolvedValue([]);
    prisma.vehicleSale.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehiclePurchase.findFirst.mockResolvedValue(options.purchase ?? null);
    prisma.invoiceSequence.upsert.mockResolvedValue({ current: 1 });
    prisma.invoice.create.mockImplementation(async ({ data }) => ({
      id: 'invoice-1',
      ...data,
      items: [],
      customer: sale.customer,
      vehicle: sale.vehicle,
    }));
    prisma.invoice.updateMany.mockResolvedValue({
      count: options.invoiceNumberCount ?? 1,
    });
    prisma.vehicle.updateMany.mockResolvedValue({
      count: options.stockGuardCount ?? 1,
    });
  };

  beforeEach(() => {
    prisma = makePrisma();
    prisma.$queryRaw.mockResolvedValue([{ id: 'site-1', is_active: true }]);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) =>
        callback(prisma),
    );
    prisma.financeSettings.update.mockResolvedValue({
      next_vehicle_sale_number: 2,
    });
    ledger = {
      listForVehicle: jest.fn().mockResolvedValue([]),
      append: jest.fn(),
    };
    snapshotCommit = {
      lockCommitmentContext: jest.fn().mockResolvedValue({
        tenantId,
        ownership: { siteId: 'site-1', legalEntityId: 'le-1' },
      }),
      lockInvoiceRow: jest.fn().mockResolvedValue(undefined),
      prepareV2Snapshot: jest.fn().mockResolvedValue({
        snapshot: { schema_version: 2 },
      }),
      persistV2Snapshot: jest.fn().mockResolvedValue(undefined),
    };
    auditService = { recordTenantMutation: jest.fn() };
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue(tenantId),
      getAuthenticatedUser: jest.fn().mockReturnValue({ userId: 'fb-user-1' }),
    };
    const siteContext = {
      getSiteId: jest.fn().mockResolvedValue('site-1'),
      listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
    };
    const requestContext = { getSource: jest.fn().mockReturnValue('API') };
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

  describe('create guards', () => {
    it('refuses a vehicle that is not dealer stock', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(
        vehicleFixture({ inventory_role: VehicleInventoryRole.CUSTOMER }),
      );
      const error = await rejectionOf(service.create(createDto()));
      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({ message: 'Vehicle is not dealer stock' });
    });

    it('refuses a vehicle that is neither in stock nor reserved', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(
        vehicleFixture({ stock_status: VehicleStockStatus.SOLD }),
      );
      const error = await rejectionOf(service.create(createDto()));
      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({
        message: 'Vehicle is not available for sale',
      });
    });

    it('refuses a vehicle reserved for another buyer', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(
        vehicleFixture({
          stock_status: VehicleStockStatus.RESERVED,
          reserved_for_customer_id: 'customer-2',
        }),
      );
      const error = await rejectionOf(service.create(createDto()));
      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({
        message: 'Vehicle is reserved for a different customer',
      });
    });

    it('lets the reserved buyer past the sellability checks', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(
        vehicleFixture({
          stock_status: VehicleStockStatus.RESERVED,
          reserved_for_customer_id: customerId,
          location: null,
        }),
      );
      prisma.customer.findFirst.mockResolvedValue(customerFixture());
      prisma.workshopOrder.count.mockResolvedValue(0);
      // The lot check is the first guard after sellability, so reaching it proves the buyer passed.
      const error = await rejectionOf(service.create(createDto()));
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error).toMatchObject({
        message:
          'Vehicle is parked at a lot that does not belong to the active site',
      });
    });

    it('refuses a vehicle with an open stock-prep workshop order', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(vehicleFixture());
      prisma.customer.findFirst.mockResolvedValue(customerFixture());
      prisma.workshopOrder.count.mockResolvedValue(1);
      const error = await rejectionOf(service.create(createDto()));
      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({
        message: 'Vehicle has an open stock-prep workshop order',
      });
      expect(prisma.workshopOrder.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenant_id: tenantId,
          site_id: 'site-1',
          vehicle_id: vehicleId,
        }),
      });
    });

    it('refuses an unknown buyer', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(vehicleFixture());
      prisma.workshopOrder.count.mockResolvedValue(0);
      prisma.customer.findFirst.mockResolvedValue(null);
      const error = await rejectionOf(service.create(createDto()));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).toMatchObject({
        message: `Customer ${customerId} not found`,
      });
    });

    it('refuses a vehicle parked on another site lot', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(
        vehicleFixture({ location: { site_id: 'site-2' } }),
      );
      prisma.customer.findFirst.mockResolvedValue(customerFixture());
      prisma.workshopOrder.count.mockResolvedValue(0);
      const error = await rejectionOf(service.create(createDto()));
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error).toMatchObject({
        message:
          'Vehicle is parked at a lot that does not belong to the active site',
      });
    });

    it('refuses an unknown vehicle', async () => {
      prisma.vehicle.findFirst.mockResolvedValue(null);
      const error = await rejectionOf(service.create(createDto()));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).toMatchObject({
        message: `Vehicle ${vehicleId} not found`,
      });
    });
  });

  describe('draft and correction guards', () => {
    it('refuses to update a sale that is no longer a draft', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue(
        saleFixture({ status: VehicleSaleStatus.INVOICED }),
      );
      const error = await rejectionOf(
        service.updateDraft(saleId, {
          sale_price: 1,
        } as PatchVehicleSaleDto),
      );
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error).toMatchObject({
        message: 'Only DRAFT sales can be updated',
      });
    });

    it('refuses a buyer change while a trade-in is attached', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue(
        saleFixture({ trade_in_purchase_id: 'purchase-1' }),
      );
      prisma.vehiclePurchase.findFirst.mockResolvedValue(tradeInFixture());
      const error = await rejectionOf(
        service.updateDraft(saleId, {
          customer_id: 'customer-2',
        } as PatchVehicleSaleDto),
      );
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error).toMatchObject({
        message: 'Remove the trade-in before changing the buyer of this sale',
      });
    });

    it('refuses a sale price below the attached trade-in allowance on update', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue(
        saleFixture({ trade_in_purchase_id: 'purchase-1' }),
      );
      prisma.vehiclePurchase.findFirst.mockResolvedValue(tradeInFixture());
      const error = await rejectionOf(
        service.updateDraft(saleId, {
          sale_price: 1500,
        } as PatchVehicleSaleDto),
      );
      expect(error).toMatchObject({
        response: { code: 'TRADE_IN_ALLOWANCE_INVALID' },
      });
    });

    it('refuses a Gewaehrleistung correction without a reason', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue(
        saleFixture({ status: VehicleSaleStatus.INVOICED }),
      );
      const error = await rejectionOf(
        service.correctGewaehrleistungSnapshot(saleId, {
          reason: '   ',
          buyer_is_consumer: true,
          gewaehrleistung_shortened_negotiated: false,
        } as CorrectGewaehrleistungSnapshotDto),
      );
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error).toMatchObject({
        message: 'Ein Korrekturgrund ist erforderlich.',
      });
      expect(auditService.recordTenantMutation).not.toHaveBeenCalled();
    });
  });

  describe('finalize', () => {
    it('refuses to finalize an unknown sale', async () => {
      prisma.vehicleSale.findFirst.mockResolvedValue(null);
      const error = await rejectionOf(service.finalize(saleId));
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error).toMatchObject({
        message: `Vehicle sale ${saleId} not found`,
      });
    });

    it('refuses to finalize when the draft changed between the two reads', async () => {
      prisma.vehicleSale.findFirst
        .mockResolvedValueOnce(saleFixture())
        .mockResolvedValueOnce(null);
      const error = await rejectionOf(service.finalize(saleId));
      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({
        message:
          'Vehicle sale state or site changed concurrently. Please refresh.',
      });
      expect(prisma.invoice.create).not.toHaveBeenCalled();
    });

    it('finalizes to INVOICED with the next RE number and retires the vehicle from stock', async () => {
      const sale = saleFixture();
      primeFinalize(sale);

      const result = await service.finalize(saleId);

      expect(result).toMatchObject({
        id: saleId,
        status: VehicleSaleStatus.INVOICED,
        invoice: { invoice_number: `RE-${year}-0001` },
      });
      expect(prisma.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenant_id: tenantId,
          customer_id: customerId,
          vehicle_id: vehicleId,
          vehicle_sale_id: saleId,
          site_id: 'site-1',
          legal_entity_id: 'le-1',
          tax_mode: 'MARGIN_SCHEME',
          status: 'FINALIZED',
          total_gross: new Prisma.Decimal(10000),
        }),
        include: expect.any(Object),
      });
      expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: vehicleId,
          tenant_id: tenantId,
          site_id: 'site-1',
          inventory_role: VehicleInventoryRole.USED,
        }),
        data: {
          stock_status: null,
          stock_received_at: null,
          stock_cost_basis: null,
          inventory_role: VehicleInventoryRole.CUSTOMER,
          customer_id: customerId,
          reserved_for_customer_id: null,
        },
      });
      expect(ledger.append).toHaveBeenCalledWith(
        expect.objectContaining({
          vehicleId,
          vehicleSaleId: saleId,
        }),
        prisma,
      );
    });

    it('refuses to finalize when the vehicle is no longer sellable at the stock guard', async () => {
      primeFinalize(saleFixture(), { stockGuardCount: 0 });
      const error = await rejectionOf(service.finalize(saleId));
      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({ message: 'Vehicle is no longer sellable' });
    });

    it('refuses to finalize when another request already numbered the invoice', async () => {
      primeFinalize(saleFixture(), { invoiceNumberCount: 0 });
      const error = await rejectionOf(service.finalize(saleId));
      expect(error).toBeInstanceOf(ConflictException);
      expect(error).toMatchObject({
        message: 'Invoice was already transitioned by another request',
      });
      expect(prisma.vehicle.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['is missing at this site', null],
      [
        'is cancelled',
        tradeInFixture({ status: VehiclePurchaseStatus.CANCELLED }),
      ],
      [
        'is not a trade-in',
        tradeInFixture({ acquisition_kind: VehicleAcquisitionKind.DIRECT }),
      ],
      [
        'was bought from a vendor',
        tradeInFixture({ seller_type: VehiclePurchaseSellerType.VENDOR }),
      ],
      [
        'belongs to another customer',
        tradeInFixture({ customer_id: 'customer-2' }),
      ],
      ['sits at another site', tradeInFixture({ site_id: 'site-2' })],
      ['has no VIN', tradeInFixture({ vin: null })],
    ])(
      'refuses to finalize when the trade-in %s',
      async (_label, purchase) => {
        primeFinalize(
          saleFixture({ trade_in_purchase_id: 'purchase-1' }),
          { purchase },
        );
        const error = await rejectionOf(service.finalize(saleId));
        expect(error).toBeInstanceOf(ConflictException);
        expect(error).toMatchObject({
          message:
            'The trade-in vehicle is no longer valid for this sale. Please refresh.',
        });
      },
    );

    it('refuses a trade-in whose VIN is the vehicle being sold', async () => {
      primeFinalize(saleFixture({ trade_in_purchase_id: 'purchase-1' }), {
        purchase: tradeInFixture({ vin: 'VIN-1' }),
      });
      const error = await rejectionOf(service.finalize(saleId));
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error).toMatchObject({
        response: { code: 'TRADE_IN_VIN_IS_SOLD_VEHICLE' },
      });
    });

    it('refuses a trade-in allowance above the sale price', async () => {
      primeFinalize(saleFixture({ trade_in_purchase_id: 'purchase-1' }), {
        purchase: tradeInFixture({ purchase_price: new Prisma.Decimal(20000) }),
      });
      const error = await rejectionOf(service.finalize(saleId));
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect(error).toMatchObject({
        response: { code: 'TRADE_IN_ALLOWANCE_INVALID' },
      });
    });

    it('nets a valid trade-in allowance into the invoice and audits the netting', async () => {
      primeFinalize(saleFixture({ trade_in_purchase_id: 'purchase-1' }), {
        purchase: tradeInFixture(),
      });

      const result = await service.finalize(saleId);

      expect(result).toMatchObject({
        status: VehicleSaleStatus.INVOICED,
        invoice: { invoice_number: `RE-${year}-0001` },
      });
      const invoiceData = prisma.invoice.create.mock.calls[0][0].data;
      expect(invoiceData.total_gross.toFixed(2)).toBe('8000.00');
      expect(snapshotCommit.prepareV2Snapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          inKindCredit: new Prisma.Decimal(2000),
        }),
      );
      expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'VehicleSale',
          entityId: saleId,
          action: AuditLogAction.UPDATE,
          before: null,
          after: expect.objectContaining({
            invoice_number: `RE-${year}-0001`,
            trade_in_purchase_id: 'purchase-1',
            sale_price: '10000.00',
            trade_in_allowance: '2000.00',
            amount_due: '8000.00',
          }),
          diff: { status: VehicleSaleStatus.INVOICED },
        }),
        prisma,
      );
    });
  });
});

import { createE2eApp } from './helpers/e2e-suite.js';
import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  AuditActorType,
  LocationType,
  Prisma,
  StockAdjustmentReason,
  TenantMemberRole,
  TransactionType,
} from '@prisma/client';
import { AuditService } from '../src/audit/audit.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  runWithTenantContext,
  type TestTenantResult,
} from './tenant-test-utils.js';
import {
  closeFinancePeriod,
  createAccountingExportInvoice,
  openAccountingExportFinancePeriod,
  seedDeAccountingExportProfile,
} from './accounting-export-test-utils.js';
import {
  seedInvoiceReadyCustomer,
  seedReadySellerAndAccountingProfile,
} from './invoice-snapshot-v2-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const ROUTE = '/api/inventory/revalue-unvalued-adjustments';
const REVALUATION_SOURCE = 'inventory.adjustment_revaluation';

interface Fixture {
  tenant: TestTenantResult;
  token: string;
  tenantPrisma: PrismaService;
  siteId: string;
  legalEntityId: string;
  binId: string;
}

describe('Revalue legacy unvalued stock corrections (AUT-1050, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const tenantIds: string[] = [];

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const id of tenantIds.splice(0)) {
      await cleanupTestTenantGraph(prisma, id);
    }
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  async function createFixture(prefix: string): Promise<Fixture> {
    const tenant = await createTestTenant(prisma, prefix);
    tenantIds.push(tenant.tenantId);
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const siteId = await resolveTestMainSiteId(prisma, tenant.tenantId);
    const site = await tenantPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, id: siteId },
      select: { legal_entity_id: true },
    });
    const binId = await createBin(tenantPrisma, tenant.tenantId, siteId);
    return {
      tenant,
      token: createTestAuthToken(app.get(AuthService), tenant),
      tenantPrisma,
      siteId,
      legalEntityId: site.legal_entity_id,
      binId,
    };
  }

  async function createBin(
    tenantPrisma: PrismaService,
    tenantId: string,
    siteId: string,
  ): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const warehouse = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        code: `WH-${suffix}`,
        name: 'Warehouse',
        type: LocationType.warehouse,
        site_id: siteId,
      },
    });
    const bin = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenantId,
        code: `BIN-${suffix}`,
        name: 'Bin A1',
        type: LocationType.bin,
        site_id: siteId,
        parent_id: warehouse.id,
      },
    });
    return bin.id;
  }

  async function createItem(
    f: Pick<Fixture, 'tenant' | 'tenantPrisma'>,
    costPrice: number | null,
  ): Promise<string> {
    const item = await f.tenantPrisma.catalogItem.create({
      data: {
        tenant_id: f.tenant.tenantId,
        sku: `AUT1050-${randomUUID().slice(0, 8)}`,
        name: 'Legacy part',
        cost_price: costPrice,
        retail_price: 19.99,
        unit: 'pcs',
      },
    });
    return item.id;
  }

  /** A pre-AUT-1048 correction: ADJUSTMENT, reference manual-adjustment, cost_basis null, stock already moved. */
  async function insertLegacyUnvaluedAdjustment(
    f: Pick<Fixture, 'tenant' | 'tenantPrisma'>,
    input: {
      itemId: string;
      siteId: string;
      binId: string;
      quantity: number;
      onHandAfter: number;
      createdAt?: Date;
    },
  ) {
    const row = await f.tenantPrisma.inventoryTransaction.create({
      data: {
        tenant_id: f.tenant.tenantId,
        site_id: input.siteId,
        item_id: input.itemId,
        location_id: input.binId,
        quantity: input.quantity,
        type: TransactionType.ADJUSTMENT,
        reference_id: 'manual-adjustment',
        cost_basis: null,
        reason: StockAdjustmentReason.INVENTORY_COUNT,
        note: 'Altbestand',
        ...(input.createdAt && { createdAt: input.createdAt }),
      },
    });
    await f.tenantPrisma.inventoryStock.upsert({
      where: {
        tenant_id_catalog_item_id_site_id_location_id: {
          tenant_id: f.tenant.tenantId,
          catalog_item_id: input.itemId,
          site_id: input.siteId,
          location_id: input.binId,
        },
      },
      update: { quantity_on_hand: input.onHandAfter },
      create: {
        tenant_id: f.tenant.tenantId,
        site_id: input.siteId,
        catalog_item_id: input.itemId,
        location_id: input.binId,
        quantity_on_hand: input.onHandAfter,
      },
    });
    return row;
  }

  function revalue(token: string, dryRun: boolean) {
    return request(app.getHttpServer())
      .post(ROUTE)
      .set('Authorization', `Bearer ${token}`)
      .send({ dryRun });
  }

  async function onHand(f: Fixture, itemId: string, binId = f.binId) {
    const stock = await f.tenantPrisma.inventoryStock.findFirstOrThrow({
      where: {
        tenant_id: f.tenant.tenantId,
        catalog_item_id: itemId,
        location_id: binId,
      },
    });
    return stock.quantity_on_hand.toString();
  }

  function ledgerRows(f: Fixture, itemId: string) {
    return f.tenantPrisma.inventoryTransaction.findMany({
      where: { tenant_id: f.tenant.tenantId, item_id: itemId },
      orderBy: { seq: 'asc' },
    });
  }

  // Scenario 1 + anti-criteria 1 and 2: a silent UPDATE of the original or a pair that changes net stock fails here.
  it('Scenario 1: revalues an unvalued +1 correction at the average in one pair, original byte-identical, on-hand unchanged', async () => {
    const f = await createFixture('aut1050-s1');
    const itemId = await createItem(f, 9.99);
    await f.tenantPrisma.inventoryTransaction.create({
      data: {
        tenant_id: f.tenant.tenantId,
        site_id: f.siteId,
        item_id: itemId,
        location_id: f.binId,
        quantity: 4,
        type: TransactionType.PURCHASE_RECEIPT,
        cost_basis: 4.5,
      },
    });
    await f.tenantPrisma.inventoryValuation.create({
      data: {
        tenant_id: f.tenant.tenantId,
        legal_entity_id: f.legalEntityId,
        catalog_item_id: itemId,
        average_unit_cost: 4.5,
        valued_quantity: 4,
      },
    });
    const original = await insertLegacyUnvaluedAdjustment(f, {
      itemId,
      siteId: f.siteId,
      binId: f.binId,
      quantity: 1,
      onHandAfter: 5,
    });
    const before = await f.tenantPrisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: original.id },
    });
    const startedAt = new Date();

    const res = await revalue(f.token, false).expect(200);

    const rows = await ledgerRows(f, itemId);
    const reversal = rows.find((r) => r.reversal_of_transaction_id === original.id)!;
    const valued = rows.find((r) => r.reference_id === 'manual-adjustment-revaluation')!;
    expect(rows).toHaveLength(4);
    expect(res.body).toMatchObject({
      dryRun: false,
      gaps: [],
      alreadyRevalued: [],
      alreadyReversed: [],
      revalued: [
        {
          originalTransactionId: original.id,
          reversalTransactionId: reversal.id,
          revaluedTransactionId: valued.id,
          quantity: '1',
          unitCost: '4.5',
          valueSource: 'AVG',
        },
      ],
    });
    expect(
      await f.tenantPrisma.inventoryTransaction.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toEqual(before);
    expect(reversal).toMatchObject({
      type: TransactionType.ADJUSTMENT,
      reference_id: 'manual-adjustment-reversal',
      cost_basis: null,
      note: 'nachbewertet',
      created_by_user_id: null,
    });
    expect(reversal.quantity.toString()).toBe('-1');
    expect(valued).toMatchObject({
      type: TransactionType.ADJUSTMENT,
      value_source: 'AVG',
      note: 'nachbewertet',
      created_by_user_id: null,
      reversal_of_transaction_id: null,
      movement_group_id: reversal.movement_group_id,
    });
    expect(valued.cost_basis?.toString()).toBe('4.5');
    expect(valued.quantity.toString()).toBe('1');
    expect(reversal.createdAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime() - 1000);
    expect(valued.createdAt.getTime()).toBeGreaterThanOrEqual(startedAt.getTime() - 1000);
    // original + reversal + new = original
    expect(
      new Prisma.Decimal(before.quantity)
        .add(reversal.quantity)
        .add(valued.quantity)
        .toString(),
    ).toBe('1');
    expect(await onHand(f, itemId)).toBe('5');

    const valuation = await f.tenantPrisma.inventoryValuation.findFirstOrThrow({
      where: { tenant_id: f.tenant.tenantId, catalog_item_id: itemId },
    });
    expect(valuation.average_unit_cost?.toString()).toBe('4.5');
    expect(valuation.valued_quantity.toString()).toBe('4');

    const audit = await f.tenantPrisma.auditLog.findMany({
      where: { tenant_id: f.tenant.tenantId, source: REVALUATION_SOURCE },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_type: AuditActorType.MIGRATION,
      entity_id: itemId,
      after: expect.objectContaining({
        originalTransactionId: original.id,
        reversalTransactionId: reversal.id,
        revaluedTransactionId: valued.id,
        note: 'nachbewertet',
      }),
    });
  });

  // Scenario 2: a rerun that books a second pair (or re-reverses a manually reversed row) fails here.
  it('Scenario 2: a second run books nothing more and reports already-nachbewertet and already-reversed originals', async () => {
    const f = await createFixture('aut1050-s2');
    const itemId = await createItem(f, 6);
    const revaluedOriginal = await insertLegacyUnvaluedAdjustment(f, {
      itemId,
      siteId: f.siteId,
      binId: f.binId,
      quantity: 2,
      onHandAfter: 2,
    });
    const otherItemId = await createItem(f, 3);
    const manuallyReversed = await insertLegacyUnvaluedAdjustment(f, {
      itemId: otherItemId,
      siteId: f.siteId,
      binId: f.binId,
      quantity: 1,
      onHandAfter: 1,
    });
    await request(app.getHttpServer())
      .post(`/api/inventory/transactions/${manuallyReversed.id}/reverse`)
      .set('Authorization', `Bearer ${f.token}`)
      .expect(201);

    const first = await revalue(f.token, false).expect(200);
    expect(first.body.revalued.map((r: { originalTransactionId: string }) => r.originalTransactionId)).toEqual([
      revaluedOriginal.id,
    ]);
    const countAfterFirst = await f.tenantPrisma.inventoryTransaction.count({
      where: { tenant_id: f.tenant.tenantId },
    });

    const second = await revalue(f.token, false).expect(200);

    expect(second.body).toMatchObject({
      revalued: [],
      gaps: [],
      alreadyRevalued: [revaluedOriginal.id],
      alreadyReversed: [manuallyReversed.id],
    });
    expect(
      await f.tenantPrisma.inventoryTransaction.count({
        where: { tenant_id: f.tenant.tenantId },
      }),
    ).toBe(countAfterFirst);
    expect(await onHand(f, itemId)).toBe('2');
  });

  // Scenario 3 + anti-criterion 3: back-dating the pair to the original's date (inside a completed export) fails here.
  it('Scenario 3: rows land in the current period and a re-download of the completed export is unchanged', async () => {
    const tenant = await createTestTenant(prisma, 'aut1050-s3');
    tenantIds.push(tenant.tenantId);
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const token = createTestAuthToken(app.get(AuthService), tenant);
    const deEntity = await tenantPrisma.legalEntity.create({
      data: {
        tenant_id: tenant.tenantId,
        name: 'Berlin Teile GmbH',
        country_iso: 'DE',
        is_active: true,
        address_street: 'Friedrichstraße 10',
        address_zip: '10117',
        address_city: 'Berlin',
        tax_number: '27/010/12345',
        payment_terms_days: 14,
        payment_terms_text: 'Zahlbar innerhalb von 14 Tagen.',
      },
    });
    const deSite = await tenantPrisma.site.create({
      data: {
        tenant_id: tenant.tenantId,
        legal_entity_id: deEntity.id,
        code: 'DE-BER',
        name: 'Berlin Branch',
        timezone: 'Europe/Berlin',
        holiday_country_iso: 'DE',
        is_active: true,
      },
    });
    const user = await prisma.user.findFirstOrThrow({
      where: { firebaseUid: tenant.firebaseUid },
      select: { id: true },
    });
    await tenantPrisma.siteMembership.create({
      data: {
        tenant_id: tenant.tenantId,
        user_id: user.id,
        site_id: deSite.id,
        is_active: true,
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { active_site_id: deSite.id },
    });
    await seedDeAccountingExportProfile(prisma, tenant.tenantId, deEntity.id, {
      isEnabled: true,
    });
    await seedReadySellerAndAccountingProfile(prisma, tenant.tenantId);
    const customer = await seedInvoiceReadyCustomer(prisma, tenant.tenantId);
    const f = { tenant, tenantPrisma };
    const invoicedItemId = await createItem(f, 20);
    const warehouse = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenant.tenantId,
        code: 'WH-DE-SALES',
        name: 'Warehouse',
        type: LocationType.warehouse,
        site_id: deSite.id,
      },
    });
    await tenantPrisma.inventoryStock.create({
      data: {
        tenant_id: tenant.tenantId,
        catalog_item_id: invoicedItemId,
        site_id: deSite.id,
        location_id: warehouse.id,
        quantity_on_hand: 100,
      },
    });

    // Closed fixture period (January 2026) that never meets the live clock.
    await openAccountingExportFinancePeriod(tenantPrisma, tenant.tenantId);
    await createAccountingExportInvoice(
      { app, tenantPrisma, authToken: token, customerId: customer.id, catalogItemId: invoicedItemId },
      { quantity: 1, unitPrice: 100, invoiceDate: '2026-01-15', siteId: deSite.id, legalEntityId: deEntity.id },
    );
    await closeFinancePeriod(prisma, tenant.tenantId, '2026-01-31');
    const period = { legalEntityId: deEntity.id, dateFrom: '2026-01-01', dateTo: '2026-01-31' };
    const preview = await request(app.getHttpServer())
      .post('/api/finance/accounting-exports/preview')
      .set('Authorization', `Bearer ${token}`)
      .send(period)
      .expect(200);
    const completed = await request(app.getHttpServer())
      .post('/api/finance/accounting-exports')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...period,
        previewHash: preview.body.previewHash,
        profileVersion: preview.body.profileVersion,
        idempotencyKey: `aut1050-${randomUUID()}`,
      })
      .expect(201);

    const binId = await createBin(tenantPrisma, tenant.tenantId, deSite.id);
    const legacyItemId = await createItem(f, 12.5);
    const original = await insertLegacyUnvaluedAdjustment(f, {
      itemId: legacyItemId,
      siteId: deSite.id,
      binId,
      quantity: 1,
      onHandAfter: 1,
      createdAt: new Date('2026-01-15T10:00:00.000Z'),
    });

    const res = await revalue(token, false).expect(200);

    expect(res.body.revalued).toHaveLength(1);
    const { reversalTransactionId, revaluedTransactionId } = res.body.revalued[0];
    const newRows = await tenantPrisma.inventoryTransaction.findMany({
      where: { tenant_id: tenant.tenantId, id: { in: [reversalTransactionId, revaluedTransactionId] } },
    });
    expect(newRows).toHaveLength(2);
    const periodEnd = new Date('2026-01-31T23:59:59.999Z').getTime();
    expect(original.createdAt.getTime()).toBeLessThanOrEqual(periodEnd);
    for (const row of newRows) {
      expect(row.createdAt.getTime()).toBeGreaterThan(periodEnd);
    }

    const download = await request(app.getHttpServer())
      .get(`/api/finance/accounting-exports/${completed.body.id}/download`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const body = download.body as Buffer;
    expect(createHash('sha256').update(body).digest('hex')).toBe(completed.body.sha256);
    const text = body.toString('latin1');
    expect(text).not.toContain(reversalTransactionId);
    expect(text).not.toContain(revaluedTransactionId);
  });

  // Scenario 4 + anti-criterion 4: inventing a value (0, a default, another legal entity's cost) fails here.
  it('Scenario 4: an article without average or last EK is a gap; the original stays untouched and no pair is written', async () => {
    const f = await createFixture('aut1050-s4');
    const itemId = await createItem(f, null);
    const original = await insertLegacyUnvaluedAdjustment(f, {
      itemId,
      siteId: f.siteId,
      binId: f.binId,
      quantity: 1,
      onHandAfter: 1,
    });
    const before = await f.tenantPrisma.inventoryTransaction.findUniqueOrThrow({
      where: { id: original.id },
    });

    const res = await revalue(f.token, false).expect(200);

    expect(res.body).toMatchObject({
      revalued: [],
      gaps: [{ originalTransactionId: original.id, itemId, locationId: f.binId }],
    });
    expect(await ledgerRows(f, itemId)).toEqual([before]);
    expect(await onHand(f, itemId)).toBe('1');
  });

  // Scenario 5: a dry run that writes ledger rows, stock, valuation or audit fails here.
  it('Scenario 5: dry-run lists what would be booked and leaves the database unchanged', async () => {
    const f = await createFixture('aut1050-s5');
    const itemId = await createItem(f, 7.25);
    const original = await insertLegacyUnvaluedAdjustment(f, {
      itemId,
      siteId: f.siteId,
      binId: f.binId,
      quantity: -1,
      onHandAfter: 3,
    });

    const res = await revalue(f.token, true).expect(200);

    expect(res.body).toMatchObject({
      dryRun: true,
      gaps: [],
      revalued: [
        {
          originalTransactionId: original.id,
          quantity: '-1',
          unitCost: '7.25',
          valueSource: 'LAST_EK',
          reversalTransactionId: null,
          revaluedTransactionId: null,
        },
      ],
    });
    expect((await ledgerRows(f, itemId)).map((r) => r.id)).toEqual([original.id]);
    expect(await onHand(f, itemId)).toBe('3');
    expect(
      await f.tenantPrisma.inventoryValuation.count({
        where: { tenant_id: f.tenant.tenantId, catalog_item_id: itemId },
      }),
    ).toBe(0);
    expect(
      await f.tenantPrisma.auditLog.count({
        where: { tenant_id: f.tenant.tenantId, source: REVALUATION_SOURCE },
      }),
    ).toBe(0);
  });

  // Scenario 6: a partial commit (first pair kept after the second statement failed in the same batch) fails here.
  it('Scenario 6: when the second statement of a batch fails, the first pair rolls back too and no original is updated', async () => {
    const f = await createFixture('aut1050-s6');
    const itemA = await createItem(f, 5);
    const itemB = await createItem(f, 8);
    const originalA = await insertLegacyUnvaluedAdjustment(f, {
      itemId: itemA,
      siteId: f.siteId,
      binId: f.binId,
      quantity: 1,
      onHandAfter: 1,
    });
    const originalB = await insertLegacyUnvaluedAdjustment(f, {
      itemId: itemB,
      siteId: f.siteId,
      binId: f.binId,
      quantity: 1,
      onHandAfter: 1,
    });
    const before = await f.tenantPrisma.inventoryTransaction.findMany({
      where: { tenant_id: f.tenant.tenantId },
      orderBy: { seq: 'asc' },
    });
    const auditService = app.get(AuditService);
    const recordTenantMutation = auditService.recordTenantMutation.bind(auditService);
    let revaluationAudits = 0;
    jest.spyOn(auditService, 'recordTenantMutation').mockImplementation(async (params, client) => {
      if (params.source === REVALUATION_SOURCE && ++revaluationAudits === 2) {
        throw new Error('simulated failure on the second pair');
      }
      return recordTenantMutation(params, client);
    });

    await revalue(f.token, false).expect(500);

    expect(
      await f.tenantPrisma.inventoryTransaction.findMany({
        where: { tenant_id: f.tenant.tenantId },
        orderBy: { seq: 'asc' },
      }),
    ).toEqual(before);
    expect(await onHand(f, itemA)).toBe('1');
    expect(await onHand(f, itemB)).toBe('1');

    jest.restoreAllMocks();
    const retry = await revalue(f.token, false).expect(200);
    expect(
      retry.body.revalued.map((r: { originalTransactionId: string }) => r.originalTransactionId),
    ).toEqual([originalA.id, originalB.id]);
  });

  // Role matrix: a non-admin role that can run the ledger revaluation fails here.
  it.each<{ role: TenantMemberRole; status: number }>([
    { role: 'TECH', status: 403 },
    { role: 'SALES', status: 403 },
    { role: 'ADMIN', status: 200 },
    { role: 'OWNER', status: 200 },
  ])('answers the revaluation command with $status for role $role', async ({ role, status }) => {
    const f = await createFixture('aut1050-role');
    await runWithTenantContext(f.tenant.tenantId, async () => {
      await prisma.tenantMember.updateMany({ where: { tenant_id: f.tenant.tenantId }, data: { role } });
    });
    const token = createTestAuthToken(app.get(AuthService), { ...f.tenant, role }, { role });

    await revalue(token, true).expect(status);
  });

  // Running without an explicit mode would apply by accident; a missing dryRun must be rejected.
  it('rejects a request without an explicit dryRun flag', async () => {
    const f = await createFixture('aut1050-dto');
    await request(app.getHttpServer())
      .post(ROUTE)
      .set('Authorization', `Bearer ${f.token}`)
      .send({})
      .expect(400);
  });

  // Tenant isolation: tenant B revaluing tenant A's legacy rows fails here.
  it('never revalues another tenant’s corrections', async () => {
    const a = await createFixture('aut1050-iso-a');
    const b = await createFixture('aut1050-iso-b');
    const itemId = await createItem(a, 4);
    const original = await insertLegacyUnvaluedAdjustment(a, {
      itemId,
      siteId: a.siteId,
      binId: a.binId,
      quantity: 1,
      onHandAfter: 1,
    });

    const res = await revalue(b.token, false).expect(200);

    expect(res.body).toMatchObject({ revalued: [], gaps: [], alreadyRevalued: [], alreadyReversed: [] });
    expect((await ledgerRows(a, itemId)).map((r) => r.id)).toEqual([original.id]);
  });
});

import { createE2eApp } from './helpers/e2e-suite.js';
import { countDbStatements } from './helpers/db-statement-counter.js';
import { countStockTransferActionStatements } from './helpers/stock-transfer-statement-counter.js';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { LedgerService } from '../src/inventory/ledger.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { SiteService } from '../src/site/site.service.js';
import { TransactionType } from '@prisma/client';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

/**
 * AUT-466: same-GmbH stock transfers between the MAIN and GRZ sites used to
 * return HTTP 500 from POST /api/stock-transfers. These e2e cases run the
 * real Nest pipeline and Postgres (no Prisma mocks), in both directions and
 * with and without an optional source bin.
 */
describe('Stock transfers MAIN <-> GRZ (AUT-466, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let siteService: SiteService;

  let tenant: TestTenantResult;
  let mainSiteId: string;
  let grzSiteId: string;
  let mainBinId: string;
  let grzBinId: string;
  let catalogItemId: string;

  beforeAll(async () => {
    app = await createE2eApp();

    prisma = app.get<PrismaService>(PrismaService);
    authService = app.get<AuthService>(AuthService);
    siteService = app.get<SiteService>(SiteService);
  });

  beforeEach(async () => {
    tenant = await createTestTenant(prisma, 'aut466');
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);

    const user = await tenantPrisma.user.findFirstOrThrow({
      where: { email: tenant.email },
      select: { id: true },
    });
    const main = await tenantPrisma.site.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, code: 'MAIN' },
      select: { id: true, legal_entity_id: true },
    });
    mainSiteId = main.id;

    // GRZ lives under the same legal entity as MAIN (same GmbH).
    const grz = await runWithTenantContext(tenant.tenantId, () =>
      siteService.createSite({
        legalEntityId: main.legal_entity_id,
        code: 'GRZ',
        name: 'Graz Workshop',
      }),
    );
    grzSiteId = grz.id;
    await runWithTenantContext(tenant.tenantId, () =>
      siteService.addSiteMembership(grzSiteId, { userId: user.id }),
    );

    const mainBin = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: mainSiteId,
        code: 'BIN-A1',
        name: 'Bin A1',
        type: 'bin',
      },
      select: { id: true },
    });
    mainBinId = mainBin.id;

    const grzBin = await tenantPrisma.storageLocation.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: grzSiteId,
        code: 'BIN-G1',
        name: 'Bin G1',
        type: 'bin',
      },
      select: { id: true },
    });
    grzBinId = grzBin.id;

    const item = await tenantPrisma.catalogItem.create({
      data: {
        tenant_id: tenant.tenantId,
        sku: `AUT466-${Date.now()}`,
        name: 'Brake pad set',
        retail_price: 49.9,
        cost_price: 20,
      },
      select: { id: true },
    });
    catalogItemId = item.id;
  });

  afterEach(async () => {
    await cleanupTestTenantGraph(prisma, tenant.tenantId).catch(
      () => undefined,
    );
  });

  afterAll(async () => {
    await teardownTestApp(app, prisma);
  });

  const token = () => createTestAuthToken(authService, tenant);

  function postTransfer(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/stock-transfers')
      .set('Authorization', `Bearer ${token()}`)
      .send(body);
  }

  function postAction(
    transferId: string,
    action: 'approve' | 'ship' | 'receive' | 'return',
    body: Record<string, unknown>,
    authToken: string = token(),
  ) {
    return request(app.getHttpServer())
      .post(`/api/stock-transfers/${transferId}/${action}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);
  }

  async function seedBinStock(siteId: string, locationId: string, qty: number) {
    await createTenantAwarePrisma(prisma, tenant.tenantId).inventoryStock.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteId,
        catalog_item_id: catalogItemId,
        location_id: locationId,
        quantity_on_hand: qty,
      },
    });
  }

  async function onHandAt(locationId: string): Promise<number> {
    const stock = await createTenantAwarePrisma(
      prisma,
      tenant.tenantId,
    ).inventoryStock.findFirst({
      where: { catalog_item_id: catalogItemId, location_id: locationId },
      select: { quantity_on_hand: true },
    });
    return Number(stock?.quantity_on_hand ?? 0);
  }

  /** Creates `count` catalog items, each with `onHand` (default 5) in the MAIN bin. */
  async function seedStockedItems(
    count: number,
    onHand = 5,
  ): Promise<string[]> {
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const items = await Promise.all(
      Array.from({ length: count }, (_, index) =>
        tenantPrisma.catalogItem.create({
          data: {
            tenant_id: tenant.tenantId,
            sku: `AUT861-${Date.now()}-${index}`,
            name: `Part ${index}`,
            retail_price: 10,
            cost_price: 5,
          },
          select: { id: true },
        }),
      ),
    );
    await tenantPrisma.inventoryStock.createMany({
      data: items.map((item) => ({
        tenant_id: tenant.tenantId,
        site_id: mainSiteId,
        catalog_item_id: item.id,
        location_id: mainBinId,
        quantity_on_hand: onHand,
      })),
    });
    return items.map((item) => item.id);
  }

  /**
   * Drives a MAIN -> GRZ transfer of `lineCount` lines up to `action` and counts that request's SQL
   * statements. Every line requests (and receives) quantity 2 unless `lineQuantities` gives one
   * distinct quantity per line.
   */
  async function statementsForAction(
    action: 'create' | 'approve' | 'ship' | 'receive',
    lineCount: number,
    lineQuantities?: number[],
  ) {
    const quantities =
      lineQuantities ?? Array.from({ length: lineCount }, () => 2);
    const itemIds = await seedStockedItems(
      quantities.length,
      Math.max(...quantities),
    );
    const statements = (send: () => Promise<{ status: number }>) =>
      countStockTransferActionStatements(async () => {
        expect((await send()).status).toBeLessThan(300);
      });

    const createRequest = () =>
      postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: itemIds.map((itemId, index) => ({
          catalogItemId: itemId,
          requestedQty: quantities[index],
          sourceLocationId: mainBinId,
        })),
      });
    if (action === 'create') {
      return statements(createRequest);
    }

    const created = await createRequest().expect(201);
    const lineIds: string[] = created.body.lines.map(
      (line: { id: string }) => line.id,
    );
    if (action === 'approve') {
      return statements(() =>
        postAction(created.body.id, 'approve', { expectedVersion: 1 }),
      );
    }
    await postAction(created.body.id, 'approve', { expectedVersion: 1 }).expect(
      201,
    );
    const ship = () =>
      postAction(created.body.id, 'ship', {
        expectedVersion: 2,
        lines: lineIds.map((id) => ({ id })),
      });
    if (action === 'ship') {
      return statements(ship);
    }
    await ship().expect(201);
    return statements(() =>
      postAction(created.body.id, 'receive', {
        expectedVersion: 3,
        idempotencyKey: `aut861-${lineCount}-${lineQuantities ? 'distinct' : 'equal'}`,
        lines: lineIds.map((id, index) => ({
          id,
          receiveQty: quantities[index],
          destLocationId: grzBinId,
        })),
      }),
    );
  }

  describe('create (POST /api/stock-transfers)', () => {
    it('creates a MAIN -> GRZ request without a source bin (201, not 500)', async () => {
      const res = await postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: [{ catalogItemId, requestedQty: 2 }],
      }).expect(201);

      expect(res.body).toMatchObject({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        status: 'REQUESTED',
        version: 1,
      });
      expect(res.body.transferNumber).toMatch(/^TR-\d{4}-\d{4}$/);
      expect(res.body.lines).toHaveLength(1);
      expect(res.body.lines[0]).toMatchObject({
        catalogItemId,
        requestedQty: '2',
        sourceLocationId: null,
      });
    });

    it('creates a MAIN -> GRZ request with a source bin on MAIN (201)', async () => {
      const res = await postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: [
          { catalogItemId, requestedQty: 1, sourceLocationId: mainBinId },
        ],
      }).expect(201);

      expect(res.body.lines[0].sourceLocationId).toBe(mainBinId);
    });

    it('creates a GRZ -> MAIN request without a source bin (201, not 500)', async () => {
      const res = await postTransfer({
        fromSiteId: grzSiteId,
        toSiteId: mainSiteId,
        lines: [{ catalogItemId, requestedQty: 3 }],
      }).expect(201);

      expect(res.body).toMatchObject({
        fromSiteId: grzSiteId,
        toSiteId: mainSiteId,
        status: 'REQUESTED',
      });
    });

    it('creates a GRZ -> MAIN request with a source bin on GRZ (201)', async () => {
      const res = await postTransfer({
        fromSiteId: grzSiteId,
        toSiteId: mainSiteId,
        lines: [
          { catalogItemId, requestedQty: 1, sourceLocationId: grzBinId },
        ],
      }).expect(201);

      expect(res.body.lines[0].sourceLocationId).toBe(grzBinId);
    });

    it('lists the MAIN <-> GRZ requests the caller just created', async () => {
      const created = await postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: [{ catalogItemId, requestedQty: 1 }],
      }).expect(201);

      const list = await request(app.getHttpServer())
        .get('/api/stock-transfers')
        .set('Authorization', `Bearer ${token()}`)
        .expect(200);

      expect(list.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: created.body.id,
            transferNumber: created.body.transferNumber,
            fromSiteId: mainSiteId,
            fromSiteName: expect.any(String),
            toSiteId: grzSiteId,
            toSiteName: 'Graz Workshop',
          }),
        ]),
      );
    });

    it('rejects a source bin that belongs to the other site with 422 (not 500)', async () => {
      const res = await postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: [
          { catalogItemId, requestedQty: 1, sourceLocationId: grzBinId },
        ],
      }).expect(422);

      expect(res.body.message).toMatch(
        /Source location not found on the from-site/,
      );
    });
  });

  describe('lifecycle (approve -> ship -> receive)', () => {
    it('MAIN -> GRZ: ships from the MAIN bin and receives into the GRZ bin', async () => {
      const { transferId, lineId } = await shipMainToGrz(2);

      const received = await receiveLine({
        transferId,
        lineId,
        destLocationId: grzBinId,
        qty: 2,
        idempotencyKey: 'aut466-main-grz-1',
      }).expect(200);

      expect(received.body.status).toBe('COMPLETED');
      expect(await onHandAt(mainBinId)).toBe(3);
      expect(await onHandAt(grzBinId)).toBe(2);
    });

    it('GRZ -> MAIN: source bin chosen at ship time, received into the MAIN bin', async () => {
      await seedBinStock(grzSiteId, grzBinId, 4);
      const { transferId, lineId } = await shipOneLineTransfer({
        fromSiteId: grzSiteId,
        toSiteId: mainSiteId,
        requestedQty: 3,
        shipSourceLocationId: grzBinId,
      });

      const received = await receiveLine({
        transferId,
        lineId,
        destLocationId: mainBinId,
        qty: 3,
        idempotencyKey: 'aut466-grz-main-1',
      }).expect(200);

      expect(received.body.status).toBe('COMPLETED');
      expect(await onHandAt(grzBinId)).toBe(1);
      expect(await onHandAt(mainBinId)).toBe(3);
    });
  });

  function getDetail(transferId: string, authToken: string = token()) {
    return request(app.getHttpServer())
      .get(`/api/stock-transfers/${transferId}`)
      .set('Authorization', `Bearer ${authToken}`);
  }

  /** Requests, approves and ships a one-line transfer, returning its ids. */
  async function shipOneLineTransfer(transfer: {
    fromSiteId: string;
    toSiteId: string;
    requestedQty: number;
    /** Bin set on the request line; omit to choose it at ship time instead. */
    sourceLocationId?: string;
    shipSourceLocationId?: string;
  }) {
    const created = await postTransfer({
      fromSiteId: transfer.fromSiteId,
      toSiteId: transfer.toSiteId,
      lines: [
        {
          catalogItemId,
          requestedQty: transfer.requestedQty,
          ...(transfer.sourceLocationId
            ? { sourceLocationId: transfer.sourceLocationId }
            : {}),
        },
      ],
    }).expect(201);
    const transferId: string = created.body.id;
    const lineId: string = created.body.lines[0].id;

    await postAction(transferId, 'approve', { expectedVersion: 1 }).expect(201);
    await postAction(transferId, 'ship', {
      expectedVersion: 2,
      lines: [
        {
          id: lineId,
          ...(transfer.shipSourceLocationId
            ? { sourceLocationId: transfer.shipSourceLocationId }
            : {}),
        },
      ],
    }).expect(201);
    return { transferId, lineId };
  }

  /** Ships a stocked MAIN -> GRZ transfer of `qty`. */
  async function shipMainToGrz(qty: number) {
    await seedBinStock(mainSiteId, mainBinId, 5);
    return shipOneLineTransfer({
      fromSiteId: mainSiteId,
      toSiteId: grzSiteId,
      requestedQty: qty,
      sourceLocationId: mainBinId,
    });
  }

  function receiveLine(line: {
    transferId: string;
    lineId: string;
    destLocationId: string;
    qty: number;
    idempotencyKey: string;
    authToken?: string;
  }) {
    return postAction(
      line.transferId,
      'receive',
      {
        expectedVersion: 3,
        idempotencyKey: line.idempotencyKey,
        lines: [
          {
            id: line.lineId,
            receiveQty: line.qty,
            destLocationId: line.destLocationId,
          },
        ],
      },
      line.authToken ?? token(),
    );
  }

  async function createRequestedTransfer(
    lineCount: number,
    sourceBinIds: string[],
  ): Promise<string> {
    const itemIds = await seedStockedItems(lineCount);
    const created = await postTransfer({
      fromSiteId: mainSiteId,
      toSiteId: grzSiteId,
      lines: itemIds.map((itemId, index) => ({
        catalogItemId: itemId,
        requestedQty: 2,
        sourceLocationId: sourceBinIds[index % sourceBinIds.length],
      })),
    }).expect(201);
    return created.body.id as string;
  }

  describe('detail (GET /api/stock-transfers/:id, AUT-909)', () => {
    it('AUT-909 S1: detail returns bin codes for source and destination, not just UUIDs', async () => {
      const { transferId, lineId } = await shipMainToGrz(2);
      await receiveLine({
        transferId,
        lineId,
        destLocationId: grzBinId,
        qty: 2,
        idempotencyKey: 'aut909-detail-bins-1',
      }).expect(200);

      const detail = await getDetail(transferId).expect(200);

      expect(detail.body.lines[0]).toMatchObject({
        fromBinCode: 'BIN-A1',
        fromBinName: 'Bin A1',
        toBinCode: 'BIN-G1',
        toBinName: 'Bin G1',
        // existing fields keep their contract
        sourceLocationId: mainBinId,
        destLocationId: grzBinId,
      });
    });

    it('AUT-909 S2: detail resolves all line bins with a constant number of SQL statements (2 vs 10 lines)', async () => {
      const secondBin = await createTenantAwarePrisma(
        prisma,
        tenant.tenantId,
      ).storageLocation.create({
        data: {
          tenant_id: tenant.tenantId,
          site_id: mainSiteId,
          code: 'BIN-A2',
          name: 'Bin A2',
          type: 'bin',
        },
        select: { id: true },
      });
      const sourceBins = [mainBinId, secondBin.id];

      const detailRun = async (lineCount: number) => {
        const transferId = await createRequestedTransfer(lineCount, sourceBins);
        let lines: Array<{ fromBinCode: string }> = [];
        const statements = await countDbStatements(async () => {
          const res = await getDetail(transferId).expect(200);
          lines = res.body.lines;
        });
        return { statements, lines };
      };

      const twoLines = await detailRun(2);
      const tenLines = await detailRun(10);

      expect(tenLines.statements).toBe(twoLines.statements);
      expect(twoLines.lines.map((line) => line.fromBinCode)).toEqual([
        'BIN-A1',
        'BIN-A2',
      ]);
      expect(tenLines.lines.map((line) => line.fromBinCode)).toEqual(
        Array.from({ length: 10 }, (_, index) =>
          index % 2 === 0 ? 'BIN-A1' : 'BIN-A2',
        ),
      );
    });
  });

  it.each(['create', 'approve', 'ship', 'receive'] as const)(
    'AUT-861 S1: transfer %s sends the same number of SQL statements for 2 and 10 lines',
    async (action) => {
      const twoLines = await statementsForAction(action, 2);
      const tenLines = await statementsForAction(action, 10);

      expect(tenLines).toBe(twoLines);
    },
  );

  // The SE accepted writes grouped by delta (AUT-861): one updateMany per
  // distinct quantity, so statements grow with the number of distinct
  // quantities, not the number of lines. EQUAL_QUANTITY_STATEMENTS is the
  // equal-quantity cost of the action (10 lines sharing one quantity -> a
  // single group everywhere); it is pinned and re-asserted so a changed
  // fixed cost fails loudly instead of silently loosening the bound. Each
  // further distinct quantity opens one more grouped line update, plus for
  // ship/receive one more grouped stock-level increment: bound = C +
  // (lines - 1) * groups. A per-line fallback (stock update + read-back +
  // line update per line) pays three statements per line against the one or
  // two this bound allows and fails; deriving C live from the same run
  // would not, because the fallback inflates the equal-quantity baseline
  // too. For approve, per-line and grouped writes coincide when every
  // quantity is distinct - its existing 2-vs-10 S1 case is the guard there.
  // AUT-909 adds exactly one constant statement per action: the response read
  // resolves line bins in a single StorageLocation query (write-path reads stay bin-free).
  // Statement counts are the action's own transaction, BEGIN..COMMIT on the
  // connection that ran it (stockTransferTransactionStatements), so auth/tenant
  // lookups and SQL other work sends on other connections of this Jest process
  // are not included (the pg spy is process-wide). Every write and the response
  // read (attachLineBins / settleAndStoreCommand) run on `tx`. Ship is 2 below the
  // earlier BEGIN..COMMIT window (28): its ledger posting resolves authorized
  // sites through listAuthorizedSiteIds() on the pool, outside `tx` (receive
  // passes authorizedSiteIds). That lookup is constant per request, so it does not
  // change the per-quantity growth this bound guards.
  const DISTINCT_QUANTITY_BOUND = {
    approve: { equalQuantityStatements: 15, groupsPerExtraQuantity: 1 },
    ship: { equalQuantityStatements: 26, groupsPerExtraQuantity: 2 },
    receive: { equalQuantityStatements: 27, groupsPerExtraQuantity: 2 },
  } as const;

  it.each(['approve', 'ship', 'receive'] as const)(
    'AUT-861 S1: transfer %s with 10 distinct quantities pays grouped writes, not per-line writes',
    async (action) => {
      const equal = await statementsForAction(action, 10);
      expect(equal).toBe(DISTINCT_QUANTITY_BOUND[action].equalQuantityStatements);

      const quantities = Array.from({ length: 10 }, (_, index) => index + 2);
      const distinct = await statementsForAction(action, 10, quantities);

      expect(distinct).toBeLessThanOrEqual(
        DISTINCT_QUANTITY_BOUND[action].equalQuantityStatements +
          DISTINCT_QUANTITY_BOUND[action].groupsPerExtraQuantity *
            (quantities.length - 1),
      );
    },
  );

  it('AUT-861 S2: two transfers shipped at the same time leave on-hand equal to the ledger', async () => {
    await seedBinStock(mainSiteId, mainBinId, 5);
    const shipOutOfMainBin = async () => {
      const created = await postTransfer({
        fromSiteId: mainSiteId,
        toSiteId: grzSiteId,
        lines: [
          { catalogItemId, requestedQty: 2, sourceLocationId: mainBinId },
        ],
      }).expect(201);
      await postAction(created.body.id, 'approve', {
        expectedVersion: 1,
      }).expect(201);
      return () =>
        postAction(created.body.id, 'ship', {
          expectedVersion: 2,
          lines: [{ id: created.body.lines[0].id }],
        });
    };
    const ships = await Promise.all([shipOutOfMainBin(), shipOutOfMainBin()]);

    const responses = await Promise.all(ships.map((ship) => ship()));

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const ledger = await createTenantAwarePrisma(
      prisma,
      tenant.tenantId,
    ).inventoryTransaction.aggregate({
      where: { item_id: catalogItemId, location_id: mainBinId },
      _sum: { quantity: true },
    });
    expect(Number(ledger._sum.quantity)).toBe(-4);
    expect(await onHandAt(mainBinId)).toBe(1);
  });

  it('AUT-861 S3: a posting that fails on its second line writes nothing to the ledger', async () => {
    const [stockedItemId] = await seedStockedItems(1);
    const tenantPrisma = createTenantAwarePrisma(prisma, tenant.tenantId);
    const ledgerBefore = await tenantPrisma.inventoryTransaction.count();

    await expect(
      runWithTenantContext(tenant.tenantId, () =>
        prisma.$transaction((tx) =>
          app.get(LedgerService).recordTransactions(
            [
              {
                itemId: stockedItemId,
                locationId: mainBinId,
                quantity: -1,
                type: TransactionType.TRANSFER_OUT,
              },
              {
                itemId: catalogItemId,
                locationId: mainBinId,
                quantity: -1,
                type: TransactionType.TRANSFER_OUT,
              },
            ],
            tx,
            { authorizedSiteIds: [mainSiteId] },
          ),
        ),
      ),
    ).rejects.toThrow('Insufficient Stock');

    expect(await tenantPrisma.inventoryTransaction.count()).toBe(ledgerBefore);
    const stocked = await tenantPrisma.inventoryStock.findFirstOrThrow({
      where: { catalog_item_id: stockedItemId, location_id: mainBinId },
    });
    expect(Number(stocked.quantity_on_hand)).toBe(5);
    expect(await onHandAt(mainBinId)).toBe(0);
  });

  describe('to-site-only member (AUT-466 review)', () => {
    // A user with membership on GRZ only: receive and return both settle
    // against the MAIN in-transit location, which this caller cannot see.
    async function createGrzOnlyToken(): Promise<string> {
      const unique = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const firebaseUid = `e2e-grz-only-${unique}`;
      const email = `grz-only-${unique}@example.com`;
      const user = await prisma.user.create({
        data: {
          firebaseUid,
          email,
          active_tenant_id: tenant.tenantId,
          memberships: {
            create: {
              tenant_id: tenant.tenantId,
              role: 'SALES',
              is_active: true,
            },
          },
        },
        select: { id: true },
      });
      await createTenantAwarePrisma(prisma, tenant.tenantId).siteMembership.create(
        {
          data: {
            tenant_id: tenant.tenantId,
            user_id: user.id,
            site_id: grzSiteId,
            is_active: true,
          },
        },
      );
      return authService.createTestToken({
        sub: firebaseUid,
        email,
        tenantId: tenant.tenantId,
        role: 'SALES',
      });
    }

    it('receives a MAIN -> GRZ shipment without from-site membership (200, not 400)', async () => {
      const grzOnlyToken = await createGrzOnlyToken();
      const { transferId, lineId } = await shipMainToGrz(2);

      const received = await receiveLine({
        transferId,
        lineId,
        destLocationId: grzBinId,
        qty: 2,
        idempotencyKey: 'aut466-grz-only-receive',
        authToken: grzOnlyToken,
      }).expect(200);

      expect(received.body.status).toBe('COMPLETED');
      expect(await onHandAt(grzBinId)).toBe(2);
      expect(await onHandAt(mainBinId)).toBe(3);
    });

    it('returns unreceived stock without from-site membership (200, back on the MAIN bin)', async () => {
      const grzOnlyToken = await createGrzOnlyToken();
      const { transferId, lineId } = await shipMainToGrz(2);

      const returned = await postAction(
        transferId,
        'return',
        {
          expectedVersion: 3,
          idempotencyKey: 'aut466-grz-only-return',
          lines: [{ id: lineId, returnQty: 2 }],
        },
        grzOnlyToken,
      ).expect(200);

      expect(returned.body.status).toBe('COMPLETED');
      expect(await onHandAt(mainBinId)).toBe(5);
      expect(await onHandAt(grzBinId)).toBe(0);
    });

    it('AUT-909: hides the source bin code from a to-site-only caller and keeps the destination bin code visible', async () => {
      const grzOnlyToken = await createGrzOnlyToken();
      const { transferId, lineId } = await shipMainToGrz(2);
      await receiveLine({
        transferId,
        lineId,
        destLocationId: grzBinId,
        qty: 2,
        idempotencyKey: 'aut909-grz-only-receive',
        authToken: grzOnlyToken,
      }).expect(200);

      const detail = await getDetail(transferId, grzOnlyToken).expect(200);

      expect(detail.body.lines[0]).toMatchObject({
        sourceLocationId: null,
        fromBinCode: null,
        fromBinName: null,
        toBinCode: 'BIN-G1',
        toBinName: 'Bin G1',
      });
    });
  });
});

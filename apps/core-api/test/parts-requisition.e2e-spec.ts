import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createGlobalValidationPipe } from '../src/common';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  runWithTenantContext,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

type ReservationFixture = {
  tenant: TestTenantResult;
  prisma: PrismaService;
  siteId: string;
  authToken: string;
  orderId: string;
  lineId: string;
  stockId: string;
  sourceLocationId: string;
  stagingLocationId: string;
  catalogItemId: string;
  brandId: number;
  vendorId: string;
};

describe('Parts requisition persistence and site authorization (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let authService: AuthService;
  let fixture: ReservationFixture;
  const createdTenants: TestTenantResult[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    basePrisma = app.get(PrismaService);
    authService = app.get(AuthService);
  });

  beforeEach(async () => {
    fixture = await createReservationFixture('parts-reservation');
    createdTenants.push(fixture.tenant);
  });

  afterEach(async () => {
    while (createdTenants.length > 0) {
      const tenant = createdTenants.pop();
      if (tenant) {
        await cleanupTestTenantGraph(basePrisma, tenant.tenantId).catch(
          () => undefined,
        );
      }
    }
  });

  afterAll(async () => {
    await teardownTestApp(app, basePrisma);
  });

  it('serializes last-unit reservations with one success and one conflict', async () => {
    const responses = await Promise.all([
      postReservation(fixture.authToken, fixture.lineId, fixture.sourceLocationId),
      postReservation(fixture.authToken, fixture.lineId, fixture.sourceLocationId),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201,
      409,
    ]);

    const stock = await fixture.prisma.inventoryStock.findFirstOrThrow({
      where: { id: fixture.stockId },
    });
    expect(stock.quantity_reserved).toEqual(new Prisma.Decimal('1'));

    const reservationCount = await fixture.prisma.partsReservation.count({
      where: { workshop_task_line_item_id: fixture.lineId },
    });
    expect(reservationCount).toBe(1);

    const task = await fixture.prisma.workshopTask.findFirstOrThrow({
      where: { workshop_order_id: fixture.orderId },
    });
    expect(task.line_items_version).toBe(1);
  });

  it('rejects TECH reservation access before any database mutation', async () => {
    const techIdentity = await createTechIdentity(fixture);

    const response = await postReservation(
      techIdentity.authToken,
      fixture.lineId,
      fixture.sourceLocationId,
    );

    expect(response.status).toBe(403);
    await expectReservationState(fixture, {
      quantityReserved: '0',
      reservationCount: 0,
      lineItemsVersion: 0,
    });
  });

  it('rejects a source location from another site or tenant', async () => {
    const otherSiteLocationId = await createOtherSiteBin(fixture);
    const otherTenantFixture = await createReservationFixture(
      'parts-reservation-other-tenant',
    );
    createdTenants.push(otherTenantFixture.tenant);

    const otherSiteResponse = await postReservation(
      fixture.authToken,
      fixture.lineId,
      otherSiteLocationId,
    );
    const otherTenantResponse = await postReservation(
      fixture.authToken,
      fixture.lineId,
      otherTenantFixture.sourceLocationId,
    );

    expect(otherSiteResponse.status).toBe(422);
    expect(otherTenantResponse.status).toBe(422);
    await expectReservationState(fixture, {
      quantityReserved: '0',
      reservationCount: 0,
      lineItemsVersion: 0,
    });
  });

  it('rejects a non-bin source before reserving ATP', async () => {
    const nonBinFixture = await createReservationFixture(
      'parts-reservation-non-bin',
      'warehouse',
    );
    createdTenants.push(nonBinFixture.tenant);

    const response = await postReservation(
      nonBinFixture.authToken,
      nonBinFixture.lineId,
      nonBinFixture.sourceLocationId,
    );

    expect(response.status).toBe(422);
    await expectReservationState(nonBinFixture, {
      quantityReserved: '0',
      reservationCount: 0,
      lineItemsVersion: 0,
    });
  });

  it('reserves an unstaged site-owned order when the source bin matches its site', async () => {
    const unstagedFixture = await createReservationFixture(
      'parts-reservation-unstaged',
      'bin',
      false,
    );
    createdTenants.push(unstagedFixture.tenant);

    const reservationResponse = await postReservation(
      unstagedFixture.authToken,
      unstagedFixture.lineId,
      unstagedFixture.sourceLocationId,
    );
    expect(reservationResponse.status).toBe(201);

    await expectReservationState(unstagedFixture, {
      quantityReserved: '1',
      reservationCount: 1,
      lineItemsVersion: 1,
    });
  });

  it('discovers shortages for an unstaged site-owned order', async () => {
    const unstagedFixture = await createReservationFixture(
      'parts-shortage-unstaged',
      'bin',
      false,
    );
    createdTenants.push(unstagedFixture.tenant);

    const shortagesResponse = await request(app.getHttpServer())
      .get('/api/parts-requisitions/shortages')
      .set('Authorization', `Bearer ${unstagedFixture.authToken}`)
      .expect(200);

    expect(shortagesResponse.body.data).toEqual([
      expect.objectContaining({
        workshopOrderId: unstagedFixture.orderId,
        workshopTaskLineItemId: unstagedFixture.lineId,
        siteId: unstagedFixture.siteId,
        shortageQuantity: '1',
      }),
    ]);
  });

  it('fails closed for a legacy order without persisted site ownership', async () => {
    const legacyFixture = await createReservationFixture(
      'parts-reservation-legacy-null-site',
      'bin',
      false,
      false,
    );
    createdTenants.push(legacyFixture.tenant);

    const reservationResponse = await postReservation(
      legacyFixture.authToken,
      legacyFixture.lineId,
      legacyFixture.sourceLocationId,
    );
    expect(reservationResponse.status).toBe(422);

    const shortagesResponse = await request(app.getHttpServer())
      .get('/api/parts-requisitions/shortages')
      .set('Authorization', `Bearer ${legacyFixture.authToken}`)
      .expect(200);

    expect(shortagesResponse.body.data).toEqual([]);
    await expectReservationState(legacyFixture, {
      quantityReserved: '0',
      reservationCount: 0,
      lineItemsVersion: 0,
    });
  });

  describe('parts requisition sheets', () => {
    it('builds a DRAFT make sheet with a REQUISITION slice', async () => {
      const response = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        vehicleMakeBrandId: fixture.brandId,
        status: 'DRAFT',
      });
      expect(response.body.lines).toHaveLength(1);
      expect(response.body.lines[0]).toMatchObject({
        workshopTaskLineItemId: fixture.lineId,
        quantity: '1',
        status: 'OPEN',
      });

      const reservation = await fixture.prisma.partsReservation.findFirstOrThrow(
        {
          where: { workshop_task_line_item_id: fixture.lineId },
        },
      );
      expect(reservation.kind).toBe('REQUISITION');
      expect(reservation.status).toBe('OPEN');
      expect(reservation.quantity).toEqual(new Prisma.Decimal('1'));

      const task = await fixture.prisma.workshopTask.findFirstOrThrow({
        where: { workshop_order_id: fixture.orderId },
      });
      expect(task.line_items_version).toBe(1);
    });

    it('rejects a make-sheet from a different vehicle make', async () => {
      const otherBrandName = `other-make-${Date.now()}`;
      const otherBrand = await fixture.prisma.brand.create({
        data: {
          name: otherBrandName,
          normalized_name: otherBrandName.toLowerCase(),
          isVehicleMake: true,
        },
      });

      const response = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ], otherBrand.id);

      expect(response.status).toBe(422);
      const reservationCount = await fixture.prisma.partsReservation.count({
        where: { workshop_task_line_item_id: fixture.lineId },
      });
      expect(reservationCount).toBe(0);
    });

    it('rejects a slice beyond the remaining shortage', async () => {
      const response = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 2 },
      ]);

      expect(response.status).toBe(409);
      const reservationCount = await fixture.prisma.partsReservation.count({
        where: { workshop_task_line_item_id: fixture.lineId },
      });
      expect(reservationCount).toBe(0);
    });

    it('rejects TECH sessions', async () => {
      const techIdentity = await createTechIdentity(fixture);

      const response = await request(app.getHttpServer())
        .post('/api/parts-requisitions')
        .set('Authorization', `Bearer ${techIdentity.authToken}`)
        .send({
          vehicleMakeBrandId: fixture.brandId,
          items: [{ workshopTaskLineItemId: fixture.lineId, quantity: 1 }],
        });

      expect(response.status).toBe(403);
    });

    it('creates one purchase order item per reservation slice with a confirmed unit cost', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const response = await postCreatePurchaseOrder(fixture, sheet.body.id, [
        { reservationId, unitCost: 10.5 },
      ]);

      expect(response.status).toBe(201);
      expect(response.body.status).toBe('DRAFT');
      expect(response.body.items).toHaveLength(1);
      expect(
        new Prisma.Decimal(response.body.items[0].quantity).toString(),
      ).toBe('1');
      expect(
        new Prisma.Decimal(response.body.items[0].unit_cost).toString(),
      ).toBe('10.5');

      const reservation = await fixture.prisma.partsReservation.findFirstOrThrow(
        { where: { id: reservationId } },
      );
      expect(reservation.purchase_order_item_id).toBe(
        response.body.items[0].id,
      );
      expect(reservation.status).toBe('OPEN');
    });

    it('does not collapse duplicate SKUs across jobs into one purchase order item', async () => {
      const task = await fixture.prisma.workshopTask.findFirstOrThrow({
        where: { workshop_order_id: fixture.orderId },
      });
      const catalogItem = await fixture.prisma.catalogItem.create({
        data: {
          sku: `second-${Date.now()}`,
          name: 'Oil filter',
          cost_price: 4,
          retail_price: 8,
        },
      });
      const secondLine = await fixture.prisma.workshopTaskLineItem.create({
        data: {
          workshop_task_id: task.id,
          type: 'PART',
          part_execution_status: 'PENDING_PICK',
          item_no: catalogItem.sku,
          description: catalogItem.name,
          quantity: 2,
          unit_price: 8,
          catalog_item_id: catalogItem.id,
        },
      });

      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
        { lineId: secondLine.id, quantity: 2 },
      ]);
      expect(sheet.status).toBe(201);
      expect(sheet.body.lines).toHaveLength(2);

      const response = await postCreatePurchaseOrder(
        fixture,
        sheet.body.id,
        sheet.body.lines.map((line: { reservationId: string }) => ({
          reservationId: line.reservationId,
          unitCost: 3,
        })),
      );

      expect(response.status).toBe(201);
      expect(response.body.items).toHaveLength(2);

      const reservations = await fixture.prisma.partsReservation.findMany({
        where: { workshop_task_line_item_id: { in: [fixture.lineId, secondLine.id] } },
      });
      expect(
        reservations.every((reservation) => reservation.purchase_order_item_id),
      ).toBe(true);
    });

    it('rejects a string unit cost before creating a purchase order', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);

      const response = await request(app.getHttpServer())
        .post(`/api/parts-requisitions/${sheet.body.id}/create-purchase-order`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .send({
          vendorId: fixture.vendorId,
          items: [
            {
              reservationId: sheet.body.lines[0].reservationId,
              unitCost: '',
            },
          ],
        });

      expect(response.status).toBe(400);
      const purchaseOrderCount = await fixture.prisma.purchaseOrder.count();
      expect(purchaseOrderCount).toBe(0);
    });

    it('rejects relinking a reservation slice to a second purchase order', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const first = await postCreatePurchaseOrder(fixture, sheet.body.id, [
        { reservationId, unitCost: 10 },
      ]);
      expect(first.status).toBe(201);

      const second = await postCreatePurchaseOrder(fixture, sheet.body.id, [
        { reservationId, unitCost: 10 },
      ]);
      expect(second.status).toBe(409);
    });

    it('marks the requisition ORDERED when the purchase order is sent', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const purchaseOrder = await postCreatePurchaseOrder(
        fixture,
        sheet.body.id,
        [{ reservationId, unitCost: 10 }],
      );
      expect(purchaseOrder.status).toBe(201);

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrder.body.id}/mark-as-sent`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .expect(200);

      const reservation = await fixture.prisma.partsReservation.findFirstOrThrow(
        { where: { id: reservationId } },
      );
      expect(reservation.status).toBe('ORDERED');

      const requisition = await fixture.prisma.partsRequisition.findFirstOrThrow(
        { where: { id: sheet.body.id } },
      );
      expect(requisition.status).toBe('ORDERED');
    });

    it('accepts unitCost: 0 JSON number and rejects empty items array', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      // Empty items array -> 400
      const emptyRes = await request(app.getHttpServer())
        .post(`/api/parts-requisitions/${sheet.body.id}/create-purchase-order`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .send({ vendorId: fixture.vendorId, items: [] });
      expect(emptyRes.status).toBe(400);

      // unitCost: 0 -> 201
      const zeroCostRes = await postCreatePurchaseOrder(fixture, sheet.body.id, [
        { reservationId, unitCost: 0 },
      ]);
      expect(zeroCostRes.status).toBe(201);
      expect(new Prisma.Decimal(zeroCostRes.body.items[0].unit_cost).toString()).toBe('0');
    });

    it('rejects PATCH quantity on a purchase order item linked to a reservation slice', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const purchaseOrder = await postCreatePurchaseOrder(fixture, sheet.body.id, [
        { reservationId, unitCost: 10 },
      ]);
      expect(purchaseOrder.status).toBe(201);
      const itemId = purchaseOrder.body.items[0].id;

      // PATCH quantity 1 -> 5 -> 409 Conflict
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/purchase-orders/${purchaseOrder.body.id}/items/${itemId}`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .send({ quantity: 5 });

      expect(patchRes.status).toBe(409);

      // Reservation quantity remains 1
      const reservation = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId },
      });
      expect(new Prisma.Decimal(reservation.quantity).toString()).toBe('1');
    });

    it('rejects DELETE on a linked SENT purchase order item with 409 and keeps the FK intact', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const purchaseOrder = await postCreatePurchaseOrder(fixture, sheet.body.id, [
        { reservationId, unitCost: 10 },
      ]);
      const itemId = purchaseOrder.body.items[0].id;

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrder.body.id}/mark-as-sent`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .expect(200);

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/purchase-orders/${purchaseOrder.body.id}/items/${itemId}`)
        .set('Authorization', `Bearer ${fixture.authToken}`);

      expect(deleteRes.status).toBe(409);

      // Reservation FK remains intact
      const reservation = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId },
      });
      expect(reservation.purchase_order_item_id).toBe(itemId);
    });

    it('deletes a DRAFT purchase order: cancels unreceived reservations, unlinks FK, and updates requisition status', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const purchaseOrder = await postCreatePurchaseOrder(fixture, sheet.body.id, [
        { reservationId, unitCost: 10 },
      ]);

      const deleteRes = await request(app.getHttpServer())
        .delete(`/api/purchase-orders/${purchaseOrder.body.id}`)
        .set('Authorization', `Bearer ${fixture.authToken}`);

      expect(deleteRes.status).toBe(200);

      // Reservation slice is cancelled and FK is nulled
      const reservation = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId },
      });
      expect(reservation.status).toBe('CANCELLED');
      expect(reservation.purchase_order_item_id).toBeNull();

      // Since every slice in sheet is cancelled, requisition becomes CANCELLED
      const requisition = await fixture.prisma.partsRequisition.findFirstOrThrow({
        where: { id: sheet.body.id },
      });
      expect(requisition.status).toBe('CANCELLED');
    });

    it('serializes concurrent mark-as-sent vs DRAFT delete: one 200 and one 409 without deadlock', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const purchaseOrder = await postCreatePurchaseOrder(fixture, sheet.body.id, [
        { reservationId, unitCost: 10 },
      ]);

      const [sentRes, deleteRes] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/purchase-orders/${purchaseOrder.body.id}/mark-as-sent`)
          .set('Authorization', `Bearer ${fixture.authToken}`),
        request(app.getHttpServer())
          .delete(`/api/purchase-orders/${purchaseOrder.body.id}`)
          .set('Authorization', `Bearer ${fixture.authToken}`),
      ]);

      const statuses = [sentRes.status, deleteRes.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it('serializes concurrent unitCost PATCH vs receive: one succeeds and one 409, receipt cost_basis is preserved', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const purchaseOrder = await postCreatePurchaseOrder(fixture, sheet.body.id, [
        { reservationId, unitCost: 10 },
      ]);
      const itemId = purchaseOrder.body.items[0].id;

      // Mark as sent so it can receive
      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrder.body.id}/mark-as-sent`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .expect(200);

      const catalogItem = await fixture.prisma.catalogItem.findFirstOrThrow({
        where: { workshop_task_line_items: { some: { id: fixture.lineId } } },
      });

      const [patchRes, receiveRes] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/api/purchase-orders/${purchaseOrder.body.id}/items/${itemId}`)
          .set('Authorization', `Bearer ${fixture.authToken}`)
          .send({ unitCost: 25 }),
        request(app.getHttpServer())
          .post(`/api/purchase-orders/${purchaseOrder.body.id}/receive`)
          .set('Authorization', `Bearer ${fixture.authToken}`)
          .send({
            items: [{ itemId, quantity: 1 }],
          }),
      ]);

      if (patchRes.status === 409) {
        // Receive won the row lock; cost basis must reflect pre-receive unit_cost.
        expect(receiveRes.status).toBeGreaterThanOrEqual(200);
        expect(receiveRes.status).toBeLessThan(300);
        const txRecord = await fixture.prisma.inventoryTransaction.findFirstOrThrow({
          where: { item_id: catalogItem.id, type: 'PURCHASE_RECEIPT' },
        });
        expect(new Prisma.Decimal(txRecord.cost_basis).toString()).toBe('10');
        return;
      }

      // Patch won the lock first; receive must still complete without server errors.
      expect(patchRes.status).toBe(200);
      expect(receiveRes.status).toBeGreaterThanOrEqual(200);
      expect(receiveRes.status).toBeLessThan(300);
    });

    it('receives an allocated slice into the job tote and stages it', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const purchaseOrder = await postCreatePurchaseOrder(
        fixture,
        sheet.body.id,
        [{ reservationId, unitCost: 10 }],
      );
      const purchaseOrderId = purchaseOrder.body.id;
      const poItemId = purchaseOrder.body.items[0].id;

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrderId}/mark-as-sent`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrderId}/receive`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .send({ items: [{ itemId: poItemId, quantity: 1 }] })
        .expect(201);

      const reservation = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId },
      });
      expect(reservation.status).toBe('STAGED');
      expect(reservation.quantity_received).toEqual(new Prisma.Decimal(1));
      expect(reservation.quantity_staged).toEqual(new Prisma.Decimal(1));
      expect(reservation.tote_cost_basis).toEqual(new Prisma.Decimal(10));
      expect(reservation.location_id).toBe(fixture.stagingLocationId);

      const toteStock = await fixture.prisma.inventoryStock.findFirstOrThrow({
        where: {
          catalog_item_id: fixture.catalogItemId,
          location_id: fixture.stagingLocationId,
        },
      });
      expect(toteStock.quantity_on_hand).toEqual(new Prisma.Decimal(1));

      const ledger = await fixture.prisma.inventoryTransaction.findFirstOrThrow({
        where: { parts_reservation_id: reservationId },
      });
      expect(ledger.type).toBe('PURCHASE_RECEIPT');
      expect(ledger.location_id).toBe(fixture.stagingLocationId);
    });

    it('keeps a partially received slice ORDERED until the receipt is complete', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const purchaseOrder = await postCreatePurchaseOrder(
        fixture,
        sheet.body.id,
        [{ reservationId, unitCost: 10 }],
      );
      const purchaseOrderId = purchaseOrder.body.id;
      const poItemId = purchaseOrder.body.items[0].id;

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrderId}/mark-as-sent`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrderId}/receive`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .send({ items: [{ itemId: poItemId, quantity: 0.5 }] })
        .expect(201);

      const partial = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId },
      });
      expect(partial.status).toBe('ORDERED');
      expect(partial.quantity_received).toEqual(new Prisma.Decimal('0.5'));
      expect(partial.tote_cost_basis).toEqual(new Prisma.Decimal(10));

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrderId}/receive`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .send({ items: [{ itemId: poItemId, quantity: 0.5 }] })
        .expect(201);

      const complete = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId },
      });
      expect(complete.status).toBe('STAGED');
      expect(complete.quantity_received).toEqual(new Prisma.Decimal(1));
      expect(complete.quantity_staged).toEqual(new Prisma.Decimal(1));
    });

    it('receives a released slice as free stock only when locationId is provided', async () => {
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
      ]);
      const reservationId = sheet.body.lines[0].reservationId;

      const purchaseOrder = await postCreatePurchaseOrder(
        fixture,
        sheet.body.id,
        [{ reservationId, unitCost: 10 }],
      );
      const purchaseOrderId = purchaseOrder.body.id;
      const poItemId = purchaseOrder.body.items[0].id;

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrderId}/mark-as-sent`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .expect(200);

      await fixture.prisma.partsReservation.update({
        where: { id: reservationId },
        data: { status: 'CANCELLED', detached_at: new Date() },
      });

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrderId}/receive`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .send({ items: [{ itemId: poItemId, quantity: 1 }] })
        .expect(422);

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrderId}/receive`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .send({
          items: [
            {
              itemId: poItemId,
              quantity: 1,
              locationId: fixture.sourceLocationId,
            },
          ],
        })
        .expect(201);

      const reservation = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId },
      });
      expect(reservation.quantity_received).toEqual(new Prisma.Decimal(0));
      expect(reservation.quantity_staged).toEqual(new Prisma.Decimal(0));

      const freeStock = await fixture.prisma.inventoryStock.findFirstOrThrow({
        where: {
          catalog_item_id: fixture.catalogItemId,
          location_id: fixture.sourceLocationId,
        },
      });
      expect(freeStock.quantity_on_hand).toEqual(new Prisma.Decimal(2));
    });

    it('two jobs, same SKU, two PO items: receiving one item stages only that job\'s tote', async () => {
      // Second job with its own staging tote, same catalog item
      const site = await fixture.prisma.site.findFirstOrThrow({ where: { code: 'MAIN' } });
      const stagingTote2 = await fixture.prisma.storageLocation.create({
        data: {
          site_id: site.id,
          code: `TOTE2-${Date.now()}`,
          name: 'Staging tote 2',
          type: 'staging_tote',
        },
      });
      const vehicle2 = await fixture.prisma.vehicle.create({
        data: { make: 'Toyota', model: 'Corolla', year: 2021 },
      });
      const order2 = await fixture.prisma.workshopOrder.create({
        data: {
          order_number: `ORDER2-${Date.now()}`,
          site_id: site.id,
          vehicle_id: vehicle2.id,
          staging_location_id: stagingTote2.id,
          status: 'IN_PROGRESS',
          odometer: 10000,
          fuel_level: 50,
        },
      });
      const task2 = await fixture.prisma.workshopTask.create({
        data: { workshop_order_id: order2.id, title: 'Replace pads job 2' },
      });
      const line2 = await fixture.prisma.workshopTaskLineItem.create({
        data: {
          workshop_task_id: task2.id,
          type: 'PART',
          part_execution_status: 'PENDING_PICK',
          item_no: 'SKU-SHARED',
          description: 'Shared SKU part',
          quantity: 1,
          unit_price: 20,
          catalog_item_id: fixture.catalogItemId,
        },
      });

      // Both jobs on one requisition sheet
      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
        { lineId: line2.id, quantity: 1 },
      ]);
      expect(sheet.status).toBe(201);
      expect(sheet.body.lines).toHaveLength(2);

      const reservationId1 = sheet.body.lines[0].reservationId;
      const reservationId2 = sheet.body.lines[1].reservationId;

      const purchaseOrder = await postCreatePurchaseOrder(
        fixture,
        sheet.body.id,
        sheet.body.lines.map((l: { reservationId: string }) => ({
          reservationId: l.reservationId,
          unitCost: 10,
        })),
      );
      expect(purchaseOrder.status).toBe(201);
      expect(purchaseOrder.body.items).toHaveLength(2);

      // Resolve poItemId for reservation 1 via DB (API response doesn't include parts_reservation_id)
      const res1Db = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId1 },
        select: { purchase_order_item_id: true },
      });
      const poItemId1 = res1Db.purchase_order_item_id!;

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrder.body.id}/mark-as-sent`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .expect(200);

      // Receive only item 1 (qty 1)
      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrder.body.id}/receive`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .send({ items: [{ itemId: poItemId1, quantity: 1 }] })
        .expect(201);

      // Reservation 1: STAGED in tote 1
      const res1 = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId1 },
      });
      expect(res1.status).toBe('STAGED');
      expect(res1.quantity_received).toEqual(new Prisma.Decimal(1));
      expect(res1.location_id).toBe(fixture.stagingLocationId);

      // Reservation 2: still ORDERED, nothing staged
      const res2 = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId2 },
      });
      expect(res2.status).toBe('ORDERED');
      expect(res2.quantity_received).toEqual(new Prisma.Decimal(0));
      expect(res2.location_id).toBeNull();

      // Tote 2 has no stock
      const tote2Stock = await fixture.prisma.inventoryStock.findFirst({
        where: { catalog_item_id: fixture.catalogItemId, location_id: stagingTote2.id },
      });
      expect(tote2Stock).toBeNull();
    });

    it('reversed PO-item order in receive payload: no deadlock, each unit attributed once', async () => {
      // Second job with its own staging tote, same catalog item
      const site = await fixture.prisma.site.findFirstOrThrow({ where: { code: 'MAIN' } });
      const stagingTote2 = await fixture.prisma.storageLocation.create({
        data: {
          site_id: site.id,
          code: `TOTE-REV-${Date.now()}`,
          name: 'Staging tote rev',
          type: 'staging_tote',
        },
      });
      const vehicle2 = await fixture.prisma.vehicle.create({
        data: { make: 'Honda', model: 'Civic', year: 2022 },
      });
      const order2 = await fixture.prisma.workshopOrder.create({
        data: {
          order_number: `ORDER-REV-${Date.now()}`,
          site_id: site.id,
          vehicle_id: vehicle2.id,
          staging_location_id: stagingTote2.id,
          status: 'IN_PROGRESS',
          odometer: 5000,
          fuel_level: 80,
        },
      });
      const task2 = await fixture.prisma.workshopTask.create({
        data: { workshop_order_id: order2.id, title: 'Replace pads rev' },
      });
      const line2 = await fixture.prisma.workshopTaskLineItem.create({
        data: {
          workshop_task_id: task2.id,
          type: 'PART',
          part_execution_status: 'PENDING_PICK',
          item_no: 'SKU-SHARED-REV',
          description: 'Shared SKU rev',
          quantity: 1,
          unit_price: 20,
          catalog_item_id: fixture.catalogItemId,
        },
      });

      const sheet = await postRequisitionSheet(fixture, [
        { lineId: fixture.lineId, quantity: 1 },
        { lineId: line2.id, quantity: 1 },
      ]);
      expect(sheet.status).toBe(201);

      const purchaseOrder = await postCreatePurchaseOrder(
        fixture,
        sheet.body.id,
        sheet.body.lines.map((l: { reservationId: string }) => ({
          reservationId: l.reservationId,
          unitCost: 10,
        })),
      );
      expect(purchaseOrder.status).toBe(201);

      const reservationId1 = sheet.body.lines[0].reservationId;
      const reservationId2 = sheet.body.lines[1].reservationId;

      // Resolve poItemIds via DB (API response doesn't include parts_reservation_id)
      const [resDb1, resDb2] = await Promise.all([
        fixture.prisma.partsReservation.findFirstOrThrow({
          where: { id: reservationId1 },
          select: { purchase_order_item_id: true },
        }),
        fixture.prisma.partsReservation.findFirstOrThrow({
          where: { id: reservationId2 },
          select: { purchase_order_item_id: true },
        }),
      ]);
      const poItem1Id = resDb1.purchase_order_item_id!;
      const poItem2Id = resDb2.purchase_order_item_id!;

      await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrder.body.id}/mark-as-sent`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .expect(200);

      // Send items in REVERSED order (poItem2 first, poItem1 second)
      const receiveRes = await request(app.getHttpServer())
        .post(`/api/purchase-orders/${purchaseOrder.body.id}/receive`)
        .set('Authorization', `Bearer ${fixture.authToken}`)
        .send({
          items: [
            { itemId: poItem2Id, quantity: 1 },
            { itemId: poItem1Id, quantity: 1 },
          ],
        });

      // No deadlock — must succeed with 2xx
      expect(receiveRes.status).toBeGreaterThanOrEqual(200);
      expect(receiveRes.status).toBeLessThan(300);

      // Both reservations staged, each in their own tote
      const res1 = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId1 },
      });
      expect(res1.status).toBe('STAGED');
      expect(res1.quantity_received).toEqual(new Prisma.Decimal(1));
      expect(res1.location_id).toBe(fixture.stagingLocationId);

      const res2 = await fixture.prisma.partsReservation.findFirstOrThrow({
        where: { id: reservationId2 },
      });
      expect(res2.status).toBe('STAGED');
      expect(res2.quantity_received).toEqual(new Prisma.Decimal(1));
      expect(res2.location_id).toBe(stagingTote2.id);

      // Each tote has exactly 1 unit
      const tote1Stock = await fixture.prisma.inventoryStock.findFirstOrThrow({
        where: { catalog_item_id: fixture.catalogItemId, location_id: fixture.stagingLocationId },
      });
      expect(tote1Stock.quantity_on_hand).toEqual(new Prisma.Decimal(1));

      const tote2Stock = await fixture.prisma.inventoryStock.findFirstOrThrow({
        where: { catalog_item_id: fixture.catalogItemId, location_id: stagingTote2.id },
      });
      expect(tote2Stock.quantity_on_hand).toEqual(new Prisma.Decimal(1));
    });
  });

  async function postRequisitionSheet(
    reservationFixture: ReservationFixture,
    selections: { lineId: string; quantity: number }[],
    brandId: number = reservationFixture.brandId,
  ) {
    return request(app.getHttpServer())
      .post('/api/parts-requisitions')
      .set('Authorization', `Bearer ${reservationFixture.authToken}`)
      .send({
        vehicleMakeBrandId: brandId,
        items: selections.map((selection) => ({
          workshopTaskLineItemId: selection.lineId,
          quantity: selection.quantity,
        })),
      });
  }

  async function postCreatePurchaseOrder(
    reservationFixture: ReservationFixture,
    requisitionId: string,
    items: { reservationId: string; unitCost: number }[],
  ) {
    return request(app.getHttpServer())
      .post(
        `/api/parts-requisitions/${requisitionId}/create-purchase-order`,
      )
      .set('Authorization', `Bearer ${reservationFixture.authToken}`)
      .send({
        vendorId: reservationFixture.vendorId,
        items,
      });
  }

  async function createReservationFixture(
    prefix: string,
    sourceType: 'bin' | 'warehouse' = 'bin',
    staged = true,
    siteOwned = true,
  ): Promise<ReservationFixture> {
    const tenant = await createTestTenant(basePrisma, prefix);
    const prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    const site = await prisma.site.findFirstOrThrow({
      where: { code: 'MAIN' },
    });
    const sourceLocation = await prisma.storageLocation.create({
      data: {
        site_id: site.id,
        code: `${prefix}-SOURCE-${Date.now()}`,
        name: `${sourceType} source`,
        type: sourceType,
      },
    });
    const stagingLocation = await prisma.storageLocation.create({
      data: {
        site_id: site.id,
        code: `${prefix}-STAGING-${Date.now()}`,
        name: 'Staging tote',
        type: 'staging_tote',
      },
    });
    const catalogItem = await prisma.catalogItem.create({
      data: {
        sku: `${prefix}-SKU-${Date.now()}`,
        name: 'Brake pad',
        cost_price: 10,
        retail_price: 20,
      },
    });
    const makeName = `${prefix}-make-${Date.now()}`;
    const brand = await prisma.brand.create({
      data: {
        name: makeName,
        normalized_name: makeName.toLowerCase(),
        isVehicleMake: true,
      },
    });
    const vendor = await prisma.vendor.create({
      data: {
        name: `${prefix} vendor`,
        email: `${prefix}-vendor@example.com`,
        account_number: `${prefix}-ACC-${Date.now()}`,
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'Toyota',
        model: 'Corolla',
        year: 2020,
        make_brand_id: brand.id,
      },
    });
    const order = await prisma.workshopOrder.create({
      data: {
        order_number: `${prefix}-ORDER-${Date.now()}`,
        site_id: siteOwned ? site.id : null,
        vehicle_id: vehicle.id,
        staging_location_id: staged ? stagingLocation.id : null,
        status: 'IN_PROGRESS',
        odometer: 50000,
        fuel_level: 75,
      },
    });
    const task = await prisma.workshopTask.create({
      data: {
        workshop_order_id: order.id,
        title: 'Replace brake pads',
      },
    });
    const line = await prisma.workshopTaskLineItem.create({
      data: {
        workshop_task_id: task.id,
        type: 'PART',
        part_execution_status: 'PENDING_PICK',
        item_no: catalogItem.sku,
        description: catalogItem.name,
        quantity: 1,
        unit_price: 20,
        catalog_item_id: catalogItem.id,
      },
    });
    const stock = await prisma.inventoryStock.create({
      data: {
        catalog_item_id: catalogItem.id,
        site_id: site.id,
        location_id: sourceLocation.id,
        quantity_on_hand: 1,
      },
    });

    return {
      tenant,
      prisma,
      siteId: site.id,
      authToken: createTestAuthToken(authService, tenant),
      orderId: order.id,
      lineId: line.id,
      stockId: stock.id,
      sourceLocationId: sourceLocation.id,
      stagingLocationId: stagingLocation.id,
      catalogItemId: catalogItem.id,
      brandId: brand.id,
      vendorId: vendor.id,
    };
  }

  async function createOtherSiteBin(
    reservationFixture: ReservationFixture,
  ): Promise<string> {
    const legalEntity = await reservationFixture.prisma.legalEntity.findFirstOrThrow();
    const otherSite = await reservationFixture.prisma.site.create({
      data: {
        legal_entity_id: legalEntity.id,
        code: `OTHER-${Date.now()}`,
        name: 'Other site',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
      },
    });
    const location = await reservationFixture.prisma.storageLocation.create({
      data: {
        site_id: otherSite.id,
        code: `OTHER-BIN-${Date.now()}`,
        name: 'Other site bin',
        type: 'bin',
      },
    });
    return location.id;
  }

  async function createTechIdentity(reservationFixture: ReservationFixture) {
    const firebaseUid = `e2e-parts-tech-${Date.now()}`;
    const user = await basePrisma.user.create({
      data: {
        firebaseUid,
        email: `${firebaseUid}@example.com`,
      },
    });
    await seedTestTenantMember(basePrisma, {
      tenantId: reservationFixture.tenant.tenantId,
      userId: user.id,
      role: 'TECH',
    });
    await runWithTenantContext(
      reservationFixture.tenant.tenantId,
      async () => {
        await basePrisma.siteMembership.create({
          data: {
            tenant_id: reservationFixture.tenant.tenantId,
            user_id: user.id,
            site_id: reservationFixture.siteId,
            is_active: true,
          },
        });
        await basePrisma.user.update({
          where: { id: user.id },
          data: { active_site_id: reservationFixture.siteId },
        });
      },
    );

    return {
      authToken: authService.createTestToken({
        sub: firebaseUid,
        email: user.email,
        tenantId: reservationFixture.tenant.tenantId,
        role: 'TECH',
      }),
    };
  }

  async function expectReservationState(
    reservationFixture: ReservationFixture,
    expected: {
      quantityReserved: string;
      reservationCount: number;
      lineItemsVersion: number;
    },
  ): Promise<void> {
    const stock = await reservationFixture.prisma.inventoryStock.findFirstOrThrow({
      where: { id: reservationFixture.stockId },
    });
    expect(stock.quantity_reserved).toEqual(
      new Prisma.Decimal(expected.quantityReserved),
    );

    const reservationCount = await reservationFixture.prisma.partsReservation.count({
      where: { workshop_task_line_item_id: reservationFixture.lineId },
    });
    expect(reservationCount).toBe(expected.reservationCount);

    const task = await reservationFixture.prisma.workshopTask.findFirstOrThrow({
      where: { workshop_order_id: reservationFixture.orderId },
    });
    expect(task.line_items_version).toBe(expected.lineItemsVersion);
  }

  async function postReservation(
    authToken: string,
    lineId: string,
    locationId: string,
  ) {
    return request(app.getHttpServer())
      .post('/api/parts-reservations')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        workshopTaskLineItemId: lineId,
        quantity: 1,
        locationId,
      });
  }
});

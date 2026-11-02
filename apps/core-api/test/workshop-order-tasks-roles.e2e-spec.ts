import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  resolveTestMainSiteId,
  seedTestEmployee,
  seedTestTenantMember,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Workshop Order Tasks Role Authorization (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let prisma: PrismaService;
  let foreignPrisma: PrismaService;
  let auth: AuthService;
  let tenantId: string;
  let siteId: string;
  let foreignTenantId: string;
  let foreignSiteId: string;

  let ownerToken: string;
  let adminToken: string;
  let salesToken: string;
  let techToken: string;
  let accountantToken: string;
  let foreignAdminToken: string;

  let customerId: string;
  let vehicleId: string;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createE2eApp(undefined, { productionErrorFilter: true });
    basePrisma = app.get(PrismaService);
    auth = app.get(AuthService);

    const tenant = await createTestTenant(basePrisma, 'aut-847');
    tenantId = tenant.tenantId;
    siteId = await resolveTestMainSiteId(basePrisma, tenantId);

    const foreignTenant = await createTestTenant(basePrisma, 'aut-847-foreign');
    foreignTenantId = foreignTenant.tenantId;
    foreignSiteId = await resolveTestMainSiteId(basePrisma, foreignTenantId);

    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    foreignPrisma = createTenantAwarePrisma(basePrisma, foreignTenantId);

    // Admin from createTestTenant already has active_tenant_id, active_site_id, and SiteMembership
    adminToken = auth.createTestToken({
      sub: tenant.firebaseUid,
      email: tenant.email,
      tenantId,
      role: 'ADMIN',
    });

    const seedScopedUser = async (role: TenantMemberRole) => {
      const uid = `task-${role.toLowerCase()}-${tenantId}`;
      const user = await prisma.user.create({
        data: {
          firebaseUid: uid,
          email: `${role.toLowerCase()}-${tenantId}@test.local`,
          active_tenant_id: tenantId,
        },
      });
      await seedTestTenantMember(basePrisma, {
        tenantId,
        userId: user.id,
        role,
      });
      await prisma.siteMembership.create({
        data: {
          tenant_id: tenantId,
          user_id: user.id,
          site_id: siteId,
          is_active: true,
        },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { active_site_id: siteId },
      });
      const token = auth.createTestToken({
        sub: uid,
        email: user.email,
        tenantId,
        role,
      });
      return { user, token };
    };

    // Seed Owner
    const ownerSetup = await seedScopedUser('OWNER');
    ownerToken = ownerSetup.token;

    // Seed Sales
    const salesSetup = await seedScopedUser('SALES');
    salesToken = salesSetup.token;

    // Seed Tech (linked to MECHANIC employee for mechanic routes)
    const techSetup = await seedScopedUser('TECH');
    techToken = techSetup.token;
    await seedTestEmployee(prisma, {
      tenantId,
      name: 'Test Mechanic',
      role: 'MECHANIC',
      userId: techSetup.user.id,
    });

    // Seed Accountant (unrelated role with token claims)
    const accountantSetup = await seedScopedUser('ACCOUNTANT');
    accountantToken = accountantSetup.token;

    // Foreign Admin from createTestTenant already has active_tenant_id, active_site_id, and SiteMembership
    foreignAdminToken = auth.createTestToken({
      sub: foreignTenant.firebaseUid,
      email: foreignTenant.email,
      tenantId: foreignTenantId,
      role: 'ADMIN',
    });

    // Seed Customer & Vehicle in Tenant A
    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenantId,
        first_name: 'Max',
        last_name: 'Mustermann',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenantId,
        vin: `VIN-${randomUUID()}`,
        make: 'VW',
        model: 'Golf',
        year: 2022,
        customer_id: customerId,
      },
    });
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    if (basePrisma && tenantId)
      await cleanupTestTenantGraph(basePrisma, tenantId);
    if (basePrisma && foreignTenantId)
      await cleanupTestTenantGraph(basePrisma, foreignTenantId);
    if (app) await teardownTestApp(app);
  });

  async function createTestOrder(): Promise<string> {
    const res = await api()
      .post('/api/workshop/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        vehicleId,
        odometer: 50000,
        fuelLevel: 80,
        notes: 'Role check test order',
      })
      .expect(201);
    return res.body.id as string;
  }

  async function createTestOrderAndTask(
    title = 'Test Task',
  ): Promise<{ orderId: string; taskId: string }> {
    const orderId = await createTestOrder();
    const taskRes = await api()
      .post(`/api/workshop/orders/${orderId}/tasks`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title })
      .expect(201);
    return { orderId, taskId: taskRes.body.id as string };
  }

  describe('POST /api/workshop/orders/:id/tasks (createTask)', () => {
    it('refuses ACCOUNTANT with 403 and WORKSHOP_ROLE_FORBIDDEN', async () => {
      const orderId = await createTestOrder();
      const res = await api()
        .post(`/api/workshop/orders/${orderId}/tasks`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ title: 'Unauthorized Task' })
        .expect(403);

      expect(res.body).toMatchObject({
        code: 'WORKSHOP_ROLE_FORBIDDEN',
      });
    });

    it('refuses TECH session with 403', async () => {
      const orderId = await createTestOrder();
      await api()
        .post(`/api/workshop/orders/${orderId}/tasks`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({ title: 'Tech Task' })
        .expect(403);
    });

    it.each([
      ['OWNER', () => ownerToken],
      ['ADMIN', () => adminToken],
      ['SALES', () => salesToken],
    ])('allows %s to create a task', async (_role, getToken) => {
      const orderId = await createTestOrder();
      const res = await api()
        .post(`/api/workshop/orders/${orderId}/tasks`)
        .set('Authorization', `Bearer ${getToken()}`)
        .send({ title: `Task for ${_role}` })
        .expect(201);

      expect(res.body.title).toBe(`Task for ${_role}`);
      expect(res.body.workshopOrderId).toBe(orderId);
    });
  });

  describe('PATCH /api/workshop/orders/:orderId/tasks/:taskId/line-items (replaceTaskLineItems)', () => {
    it('refuses ACCOUNTANT with 403 and WORKSHOP_ROLE_FORBIDDEN', async () => {
      const { orderId, taskId } =
        await createTestOrderAndTask('Line Items Task');

      const res = await api()
        .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({
          expectedLineItemsVersion: 0,
          items: [
            {
              type: 'LABOR',
              itemNo: 'LAB-1',
              description: 'Labor',
              qty: 1,
              unitPrice: 50,
            },
          ],
        })
        .expect(403);

      expect(res.body).toMatchObject({
        code: 'WORKSHOP_ROLE_FORBIDDEN',
      });
    });

    it('refuses TECH with 403', async () => {
      const { orderId, taskId } =
        await createTestOrderAndTask('Line Items Task');

      await api()
        .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({
          expectedLineItemsVersion: 0,
          items: [
            {
              type: 'LABOR',
              itemNo: 'LAB-1',
              description: 'Labor',
              qty: 1,
              unitPrice: 50,
            },
          ],
        })
        .expect(403);
    });

    it.each([
      ['OWNER', () => ownerToken],
      ['ADMIN', () => adminToken],
      ['SALES', () => salesToken],
    ])('allows %s to replace task line items', async (_role, getToken) => {
      const { orderId, taskId } = await createTestOrderAndTask(
        `Line Task for ${_role}`,
      );

      const res = await api()
        .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/line-items`)
        .set('Authorization', `Bearer ${getToken()}`)
        .send({
          expectedLineItemsVersion: 0,
          items: [
            {
              type: 'LABOR',
              itemNo: `LAB-${_role}`,
              description: 'Work',
              qty: 1,
              unitPrice: 75,
            },
          ],
        })
        .expect(200);

      expect(res.body.id).toBe(orderId);
    });
  });

  describe('PATCH /api/workshop/orders/:orderId/tasks/:taskId (updateTask)', () => {
    it('refuses ACCOUNTANT with 403 and WORKSHOP_ROLE_FORBIDDEN', async () => {
      const { orderId, taskId } = await createTestOrderAndTask('Update Task');

      const res = await api()
        .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ title: 'Accountant Rename' })
        .expect(403);

      expect(res.body).toMatchObject({
        code: 'WORKSHOP_ROLE_FORBIDDEN',
      });
    });

    it.each([
      ['OWNER', () => ownerToken],
      ['ADMIN', () => adminToken],
      ['SALES', () => salesToken],
    ])('allows %s to update task', async (_role, getToken) => {
      const { orderId, taskId } =
        await createTestOrderAndTask('Original Title');

      const res = await api()
        .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${getToken()}`)
        .send({ title: `Updated by ${_role}` })
        .expect(200);

      expect(
        res.body.tasks.find((t: { id: string }) => t.id === taskId)?.title,
      ).toBe(`Updated by ${_role}`);
    });
  });

  describe('DELETE /api/workshop/orders/:orderId/tasks/:taskId (deleteTask)', () => {
    it('refuses ACCOUNTANT with 403 and WORKSHOP_ROLE_FORBIDDEN', async () => {
      const { orderId, taskId } =
        await createTestOrderAndTask('Task to Delete');

      const res = await api()
        .delete(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .expect(403);

      expect(res.body).toMatchObject({
        code: 'WORKSHOP_ROLE_FORBIDDEN',
      });
    });

    it('refuses TECH with 403', async () => {
      const { orderId, taskId } =
        await createTestOrderAndTask('Task to Delete');

      await api()
        .delete(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${techToken}`)
        .expect(403);
    });

    it.each([
      ['OWNER', () => ownerToken],
      ['ADMIN', () => adminToken],
      ['SALES', () => salesToken],
    ])('allows %s to delete a task', async (_role, getToken) => {
      const { orderId, taskId } = await createTestOrderAndTask(
        `Delete by ${_role}`,
      );

      const res = await api()
        .delete(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${getToken()}`)
        .expect(200);

      expect(
        res.body.tasks.find((t: { id: string }) => t.id === taskId),
      ).toBeUndefined();
    });
  });

  describe('Checklist updates and Mechanic execution', () => {
    it('refuses ACCOUNTANT with 403 on task checklist update', async () => {
      const { orderId, taskId } =
        await createTestOrderAndTask('Checklist Task');

      const res = await api()
        .patch(`/api/workshop/orders/${orderId}/tasks/${taskId}/checklist`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({ items: [] })
        .expect(403);

      expect(res.body).toMatchObject({
        code: 'WORKSHOP_ROLE_FORBIDDEN',
      });
    });

    it('allows TECH session to update task checklist via mechanic surface', async () => {
      const { orderId, taskId } = await createTestOrderAndTask('Mechanic Task');

      // Create inspection and assign task to this mechanic
      const mechanicEmployee = await prisma.employee.findFirstOrThrow({
        where: { tenant_id: tenantId, role: 'MECHANIC' },
      });
      await prisma.workshopTask.update({
        where: { id: taskId },
        data: { mechanic_id: mechanicEmployee.id },
      });
      const inspection = await prisma.workshopInspection.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          workshop_task_id: taskId,
          title: 'Test Inspection',
        },
      });
      const item = await prisma.workshopInspectionItem.create({
        data: {
          tenant_id: tenantId,
          workshop_inspection_id: inspection.id,
          label_snapshot: 'Test Item',
          sort_order: 1,
        },
      });

      // Mechanic updates checklist
      const res = await api()
        .patch(`/api/mechanic/tasks/${taskId}/checklist`)
        .set('Authorization', `Bearer ${techToken}`)
        .send({
          items: [{ id: item.id, passed: true, notes: 'Checked by tech' }],
        })
        .expect(200);

      expect(res.body.id).toBe(inspection.id);
    });
  });

  describe('Cross-tenant isolation', () => {
    it('returns 404 when allowed role in Tenant B tries to write to Tenant A task', async () => {
      const { orderId, taskId } = await createTestOrderAndTask('Tenant A Task');

      // Foreign Admin in Tenant B tries to delete task in Tenant A
      await api()
        .delete(`/api/workshop/orders/${orderId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${foreignAdminToken}`)
        .expect(404);

      // Foreign Admin in Tenant B tries to create task on Tenant A order
      await api()
        .post(`/api/workshop/orders/${orderId}/tasks`)
        .set('Authorization', `Bearer ${foreignAdminToken}`)
        .send({ title: 'Cross Tenant Task' })
        .expect(404);
    });
  });
});

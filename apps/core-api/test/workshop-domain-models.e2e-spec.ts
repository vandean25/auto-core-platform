import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
} from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

jest.setTimeout(30000);

describe('Workshop Domain Models (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let tenantId: string;
  let customerId: string;
  let vehicleId: string;
  let orderId: string;
  let taskId: string;
  let mechanicId: string;
  let authToken: string;
  let templateId: string;
  let templateItemId: string;
  let inspectionId: string;

  beforeAll(async () => {
    process.env.API_KEY = 'test-api-key';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();

    const basePrisma = app.get<PrismaService>(PrismaService);
    const authService = app.get<AuthService>(AuthService);
    const testTenant = await createTestTenant(basePrisma, 'workshop-domain');
    tenantId = testTenant.tenantId;
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
    authToken = authService.createTestToken({
      sub: 'e2e-workshop-domain-user',
      email: 'e2e-workshop-domain-user@example.com',
      tenantId,
      role: 'ADMIN',
    });

    const customer = await prisma.customer.create({
      data: {
        first_name: 'Domain',
        last_name: 'Tester',
        email: `workshop-domain-${Date.now()}@example.com`,
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const vehicle = await prisma.vehicle.create({
      data: {
        make: 'Skoda',
        model: 'Octavia',
        year: 2021,
        vin: `VIN-DOMAIN-${Date.now()}`,
        customer_id: customerId,
      },
    });
    vehicleId = vehicle.id;

    const mechanic = await prisma.employee.create({
      data: {
        name: 'Domain Mechanic',
        role: 'MECHANIC',
        is_active: true,
      },
    });
    mechanicId = mechanic.id;

    const order = await prisma.workshopOrder.create({
      data: {
        order_number: `WO-DOMAIN-${Date.now()}`,
        customer_id: customerId,
        vehicle_id: vehicleId,
        mechanic_id: mechanicId,
        odometer: 88000,
        fuel_level: 35,
        status: 'INTAKE',
      },
    });
    orderId = order.id;

    const task = await prisma.workshopTask.create({
      data: {
        workshop_order_id: orderId,
        title: 'Brake inspection task',
        status: 'NOT_STARTED',
        mechanic_id: mechanicId,
      },
    });
    taskId = task.id;
  });

  afterAll(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(app.get<PrismaService>(PrismaService), tenantId);
    }
    await teardownTestApp(app, prisma);
  });

  it('persists inspection templates, inspections, media metadata, and part execution status', async () => {
    const template = await prisma.inspectionTemplate.create({
      data: {
        code: `MPI-${Date.now()}`,
        title: 'Multi-point inspection',
        version: 1,
        is_active: true,
        items: {
          create: [
            {
              code: 'BRAKE-PAD',
              label: 'Brake pad wear',
              response_type: 'PASS_FAIL',
              unit: 'mm',
              sort_order: 1,
              is_required: true,
              is_active: true,
            },
          ],
        },
      },
      include: { items: true },
    });
    templateId = template.id;
    templateItemId = template.items[0]?.id ?? '';

    const inspection = await prisma.workshopInspection.create({
      data: {
        workshop_order_id: orderId,
        workshop_task_id: taskId,
        inspection_template_id: template.id,
        title: 'Brake inspection',
        items: {
          create: [
            {
              inspection_template_item_id: template.items[0]?.id,
              label_snapshot: 'Brake pad wear',
              response_value: 'Replace soon',
              unit: 'mm',
              passed: false,
              severity: 'ADVISORY',
              notes: 'Pads are near minimum thickness.',
            },
          ],
        },
      },
      include: { items: true },
    });
    inspectionId = inspection.id;

    const media = await prisma.workshopMedia.create({
      data: {
        workshop_order_id: orderId,
        workshop_task_id: taskId,
        uploaded_by_employee_id: mechanicId,
        storage_bucket: 'workshop-media-test',
        storage_key: `tenant/${tenantId}/orders/${orderId}/tasks/${taskId}/brake-pad.jpg`,
        url_strategy: 'SIGNED',
        mime_type: 'image/jpeg',
        size_bytes: 24576,
        caption: 'Brake pad wear photo',
      },
    });

    const partLine = await prisma.workshopTaskLineItem.create({
      data: {
        workshop_task_id: taskId,
        type: 'PART',
        item_no: 'PAD-001',
        description: 'Brake pad set',
        quantity: 1,
        unit_price: 90,
        part_execution_status: 'PENDING_PICK',
      },
    });

    expect(template.items).toHaveLength(1);
    expect(inspection.workshop_order_id).toBe(orderId);
    expect(inspection.workshop_task_id).toBe(taskId);
    expect(inspection.items[0]?.inspection_template_item_id).toBe(
      template.items[0]?.id,
    );
    expect(media.storage_key).toContain(orderId);
    expect(partLine.part_execution_status).toBe('PENDING_PICK');
  });

  it('returns part execution status on the workshop order response', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/workshop/orders/${orderId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.tasks).toHaveLength(1);
    expect(response.body.tasks[0].lineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'PART',
          partExecutionStatus: 'PENDING_PICK',
        }),
      ]),
    );
  });
});

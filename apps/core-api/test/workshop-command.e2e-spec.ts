import { INestApplication } from '@nestjs/common';
import type { TenantMemberRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { WorkshopCommandSessionRetentionService } from '../src/workshop-command/workshop-command-session-retention.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
  resolveTestMainSiteId,
  seedTestTenantMember,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const INTERPRET_PATH = '/api/workshop/commands/interpret';
const PROPOSE_PATH = '/api/workshop/commands/propose';
const CONTRACT_VERSION = 'workshop-command/v1';

const FULL_SENTENCE =
  'Huber Golf montag 8 Uhr großes Service + Pickerl, Bremsen vorne prüfen, Leihwagen reservieren';
const NO_LOANER_SENTENCE = 'Huber Golf montag 8 Uhr großes Service';

type InterpretBody = {
  contract_version: string;
  status: string;
  command_id: string;
  code?: string;
  choices?: Array<{
    choice_id: string;
    slot: string;
    value: string;
    label: string;
  }>;
  site_id?: string;
  customer_id?: string;
  vehicle_id?: string;
  bay_id?: string;
  schedule?: { start_at: string; end_at: string; duration_minutes: number };
  loaner?: { requested: boolean; loaner_vehicle_id: string | null };
  position_plan?: { version: number; lines: unknown[] };
  intent?: Record<string, unknown>;
};

describe('Workshop command (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let authService: AuthService;
  let tenant: TestTenantResult;
  let prisma: PrismaService;
  let authToken: string;
  let siteId: string;
  let customerId: string;
  let golfId: string;
  let poloId: string;
  let bayId: string;
  let loanerVehicleId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    basePrisma = app.get(PrismaService);
    authService = app.get(AuthService);
  });

  afterAll(async () => {
    await teardownTestApp(app, basePrisma);
  });

  beforeEach(async () => {
    tenant = await createTestTenant(basePrisma, 'workshop-command');
    prisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
    authToken = createTestAuthToken(authService, tenant);
    siteId = await resolveTestMainSiteId(basePrisma, tenant.tenantId);

    const customer = await prisma.customer.create({
      data: {
        tenant_id: tenant.tenantId,
        first_name: 'Alex',
        last_name: 'Huber',
        type: 'PRIVATE',
      },
    });
    customerId = customer.id;

    const golf = await prisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        make: 'Volkswagen',
        model: 'Golf',
        year: 2019,
        plate: 'W-SYN 515',
        vin: 'WVWZZZ3CZWE000515',
      },
    });
    golfId = golf.id;

    const polo = await prisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        make: 'Volkswagen',
        model: 'Polo',
        year: 2021,
        plate: 'W-SYN 516',
        vin: 'WVWZZZ3CZWE000516',
      },
    });
    poloId = polo.id;

    const bay = await prisma.bay.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteId,
        name: 'Bucht 1',
        is_active: true,
        sort_order: 1,
      },
    });
    bayId = bay.id;

    const fleetVehicle = await prisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        make: 'Seat',
        model: 'Ibiza',
        year: 2022,
        plate: 'W-SYN 900',
        vin: 'WVWZZZ3CZWE000900',
      },
    });
    const loaner = await prisma.loanerVehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        site_id: siteId,
        vehicle_id: fleetVehicle.id,
        display_name: 'Leihwagen Gelb',
        status: 'AVAILABLE',
        active: true,
      },
    });
    loanerVehicleId = loaner.id;

    const operations = await Promise.all([
      prisma.laborOperation.create({
        data: {
          tenant_id: tenant.tenantId,
          code: 'SVC-MAJOR',
          description: 'Großes Service',
          standard_aw: '90.00',
          hourly_rate: '90.00',
        },
      }),
      prisma.laborOperation.create({
        data: {
          tenant_id: tenant.tenantId,
          code: 'PICKERL',
          description: 'Pickerl §57a',
          standard_aw: '30.00',
          hourly_rate: '90.00',
        },
      }),
      prisma.laborOperation.create({
        data: {
          tenant_id: tenant.tenantId,
          code: 'BRAKES-FRONT',
          description: 'Bremsen vorne prüfen',
          standard_aw: '30.00',
          hourly_rate: '90.00',
        },
      }),
    ]);

    await prisma.workshopCommandPreset.createMany({
      data: [
        {
          tenant_id: tenant.tenantId,
          preset_key: 'service.major',
          kind: 'LABOR',
          labor_operation_id: operations[0].id,
          duration_minutes: 90,
          active: true,
        },
        {
          tenant_id: tenant.tenantId,
          preset_key: 'inspection.pickerl_57a',
          kind: 'LABOR',
          labor_operation_id: operations[1].id,
          duration_minutes: 30,
          active: true,
        },
        {
          tenant_id: tenant.tenantId,
          preset_key: 'inspection.brakes_front',
          kind: 'LABOR',
          labor_operation_id: operations[2].id,
          duration_minutes: 30,
          active: true,
        },
        {
          tenant_id: tenant.tenantId,
          preset_key: 'loaner.reserve',
          kind: 'LOANER_FLAG',
          active: true,
        },
      ],
    });
  });

  afterEach(async () => {
    if (tenant) {
      await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
    }
  });

  function newCommandId(): string {
    return randomUUID();
  }

  function interpret(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(INTERPRET_PATH)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        contract_version: CONTRACT_VERSION,
        source: 'keyboard',
        locale: 'de-AT',
        ...body,
      });
  }

  function propose(
    commandId: string,
    selections?: Array<{ slot: string; value: string }>,
  ) {
    return request(app.getHttpServer())
      .post(PROPOSE_PATH)
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        contract_version: CONTRACT_VERSION,
        command_id: commandId,
        ...(selections ? { selections } : {}),
      });
  }

  async function enableBookingPolicy() {
    await request(app.getHttpServer())
      .put('/api/agent-policy/rules/workshop.booking_package')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ tier: 'PROPOSE', enabled: true })
      .expect(200);
  }

  async function interpretReady(
    overrides: Record<string, unknown> = {},
  ): Promise<InterpretBody> {
    const response = await interpret({
      command_id: newCommandId(),
      text: FULL_SENTENCE,
      ...overrides,
    }).expect(200);
    expect(response.body.status).toBe('ready');
    return response.body as InterpretBody;
  }

  async function createCallerWithRole(role: TenantMemberRole): Promise<string> {
    const uid = `workshop-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await basePrisma.user.create({
      data: {
        firebaseUid: uid,
        email: `${uid}@test.local`,
      },
      select: { id: true },
    });
    await seedTestTenantMember(basePrisma, {
      tenantId: tenant.tenantId,
      userId: user.id,
      role,
    });
    await prisma.siteMembership.create({
      data: {
        tenant_id: tenant.tenantId,
        user_id: user.id,
        site_id: siteId,
        is_active: true,
      },
    });
    await basePrisma.user.update({
      where: { id: user.id },
      data: { active_site_id: siteId },
    });
    if (role === 'DEMO') {
      const accessRequest = await basePrisma.landingDemoAccessRequest.create({
        data: {
          email: `${uid}@test.local`,
          name: 'Demo User',
          betrieb: 'Demo Corp',
          consent_recorded_at: new Date(),
        },
        select: { id: true },
      });
      await basePrisma.landingDemoSignInGrant.create({
        data: {
          access_request_id: accessRequest.id,
          user_id: user.id,
          expires_at: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
    }
    return `Bearer ${createTestAuthToken(authService, tenant, {
      sub: uid,
      email: `${uid}@test.local`,
      role,
    })}`;
  }

  async function createApiKeyCaller(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/tenant-api-keys')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ name: 'Role Matrix Key', scopes: ['workshop_orders:write'] })
      .expect(201);
    return `Bearer ${res.body.token}`;
  }

  async function createSalesCaller() {
    const uid = `workshop-sales-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await basePrisma.user.create({
      data: {
        firebaseUid: uid,
        email: `${uid}@test.local`,
      },
      select: { id: true },
    });
    await seedTestTenantMember(basePrisma, {
      tenantId: tenant.tenantId,
      userId: user.id,
      role: 'SALES',
    });
    await prisma.siteMembership.create({
      data: {
        tenant_id: tenant.tenantId,
        user_id: user.id,
        site_id: siteId,
        is_active: true,
      },
    });
    await basePrisma.user.update({
      where: { id: user.id },
      data: { active_site_id: siteId },
    });
    return `Bearer ${createTestAuthToken(authService, tenant, {
      sub: uid,
      email: `${uid}@test.local`,
      role: 'SALES',
    })}`;
  }

  it('interprets the sample sentence locally without creating domain rows', async () => {
    const body = await interpretReady();

    expect(body.contract_version).toBe(CONTRACT_VERSION);
    expect(body.site_id).toBe(siteId);
    expect(body.customer_id).toBe(customerId);
    expect(body.vehicle_id).toBe(golfId);
    expect(body.bay_id).toBe(bayId);
    expect(body.schedule).toEqual(
      expect.objectContaining({
        local_start: '08:00',
        local_end: '10:30',
        duration_minutes: 150,
        duration_source: 'preset_sum',
      }),
    );
    expect(body.loaner).toEqual(
      expect.objectContaining({
        requested: true,
        loaner_vehicle_id: loanerVehicleId,
      }),
    );
    expect(body.position_plan?.lines).toHaveLength(3);

    expect(
      await prisma.workshopOrder.count({
        where: { tenant_id: tenant.tenantId },
      }),
    ).toBe(0);
    expect(
      await prisma.loanerBooking.count({
        where: { tenant_id: tenant.tenantId },
      }),
    ).toBe(0);
  });

  it('answers customer and vehicle ambiguity inside the same command', async () => {
    const secondCustomer = await prisma.customer.create({
      data: {
        tenant_id: tenant.tenantId,
        first_name: 'Birgit',
        last_name: 'Huber',
        type: 'PRIVATE',
      },
    });
    await prisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: secondCustomer.id,
        make: 'Volkswagen',
        model: 'Golf',
        year: 2020,
        plate: 'W-SYN 517',
        vin: 'WVWZZZ3CZWE000517',
      },
    });
    const secondGolf = await prisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        customer_id: customerId,
        make: 'Volkswagen',
        model: 'Golf',
        year: 2016,
        plate: 'W-SYN 518',
        vin: 'WVWZZZ3CZWE000518',
      },
    });

    const commandId = newCommandId();
    const customerClarification = (
      await interpret({ command_id: commandId, text: FULL_SENTENCE }).expect(
        200,
      )
    ).body as InterpretBody;
    expect(customerClarification.status).toBe('clarification');
    expect(customerClarification.code).toBe('CUSTOMER_AMBIGUOUS');
    const customerChoices = customerClarification.choices ?? [];
    expect(customerChoices.map((choice) => choice.slot)).toEqual([
      'customer_id',
      'customer_id',
    ]);

    const vehicleClarification = (
      await interpret({
        command_id: commandId,
        text: FULL_SENTENCE,
        selections: [{ slot: 'customer_id', value: customerId }],
      }).expect(200)
    ).body as InterpretBody;
    expect(vehicleClarification.status).toBe('clarification');
    expect(vehicleClarification.code).toBe('VEHICLE_AMBIGUOUS');
    const vehicleChoices = (vehicleClarification.choices ?? []).map(
      (choice) => choice.value,
    );
    expect(vehicleChoices).toEqual(
      expect.arrayContaining([golfId, secondGolf.id]),
    );

    const resolved = (
      await interpret({
        command_id: commandId,
        text: FULL_SENTENCE,
        selections: [
          { slot: 'customer_id', value: customerId },
          { slot: 'vehicle_id', value: secondGolf.id },
        ],
      }).expect(200)
    ).body as InterpretBody;
    expect(resolved.status).toBe('ready');
    expect(resolved.vehicle_id).toBe(secondGolf.id);

    await enableBookingPolicy();
    await propose(commandId, [
      { slot: 'customer_id', value: customerId },
      { slot: 'vehicle_id', value: secondGolf.id },
    ]).expect(201);
  });

  it('rejects selections that were never offered', async () => {
    const response = await interpret({
      command_id: newCommandId(),
      text: FULL_SENTENCE,
      selections: [{ slot: 'bay_id', value: randomUUID() }],
    }).expect(409);
    expect(response.body.code).toBe('SELECTION_NOT_OFFERED');
  });

  it('reuses a command id only for the identical sentence', async () => {
    const commandId = newCommandId();
    await interpret({ command_id: commandId, text: FULL_SENTENCE }).expect(200);

    const response = await interpret({
      command_id: commandId,
      text: NO_LOANER_SENTENCE,
    }).expect(409);
    expect(response.body.code).toBe('COMMAND_ID_REUSED');
  });

  it('proposes once, retries idempotently, and keeps rows unchanged before apply', async () => {
    await enableBookingPolicy();
    const intent = await interpretReady();
    const commandId = intent.command_id;

    const created = await propose(commandId).expect(201);
    expect(created.body).toEqual(
      expect.objectContaining({
        status: 'needs_approval',
        command_id: commandId,
        action_type: 'workshop.booking_package',
        tier: 'PROPOSE',
        provisional: true,
        applied: false,
      }),
    );
    expect(created.body.intent).toEqual(
      expect.not.objectContaining({ status: expect.anything() }),
    );
    expect(created.body.would_change).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entity: 'WorkshopOrder', op: 'create' }),
        expect.objectContaining({ entity: 'LoanerBooking', op: 'create' }),
      ]),
    );

    const stored = await prisma.agentProposal.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, command_id: commandId },
    });
    expect(stored.status).toBe('PENDING');
    expect(
      (stored.preview_json as Record<string, unknown>).command_fingerprint,
    ).toEqual(expect.any(String));

    const retried = await propose(commandId).expect(200);
    expect(retried.body.pending_action_id).toBe(created.body.pending_action_id);
    expect(retried.body.trace_id).toBe(created.body.trace_id);

    expect(
      await prisma.workshopOrder.count({
        where: { tenant_id: tenant.tenantId },
      }),
    ).toBe(0);
    expect(
      await prisma.loanerBooking.count({
        where: { tenant_id: tenant.tenantId },
      }),
    ).toBe(0);
  });

  it('refuses to propose a plan that a live labor rate made more expensive', async () => {
    await enableBookingPolicy();
    const intent = await interpretReady();

    await prisma.laborOperation.updateMany({
      where: { tenant_id: tenant.tenantId, code: 'SVC-MAJOR' },
      data: { hourly_rate: '180.00' },
    });
    const response = await propose(intent.command_id).expect(409);

    expect(response.body.code).toBe('PLAN_STALE');
    expect(
      await prisma.agentProposal.count({
        where: { tenant_id: tenant.tenantId, command_id: intent.command_id },
      }),
    ).toBe(0);
  });

  it('applies the approved proposal into a linked order, tasks, lines, and loaner', async () => {
    await enableBookingPolicy();
    const intent = await interpretReady();
    const created = await propose(intent.command_id).expect(201);

    const replay = await prisma.workshopCommandSession.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, command_id: intent.command_id },
    });
    expect(replay.site_id).toBe(siteId);

    const applied = await request(app.getHttpServer())
      .post(`/api/agent-proposals/${created.body.pending_action_id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(applied.body.status).toBe('EXECUTED');

    const order = await prisma.workshopOrder.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, vehicle_id: golfId },
    });
    expect(order.status).toBe('SCHEDULED');
    expect(order.site_id).toBe(siteId);
    expect(order.bay_id).toBe(bayId);
    expect(order.scheduled_start_at?.toISOString()).toBe(
      intent.schedule!.start_at,
    );
    expect(order.scheduled_end_at?.toISOString()).toBe(intent.schedule!.end_at);

    const tasks = await prisma.workshopTask.findMany({
      where: { tenant_id: tenant.tenantId, workshop_order_id: order.id },
    });
    expect(tasks).toHaveLength(3);
    expect(
      await prisma.workshopTaskLineItem.count({
        where: {
          tenant_id: tenant.tenantId,
          workshop_task_id: { in: tasks.map((task) => task.id) },
        },
      }),
    ).toBe(3);

    const booking = await prisma.loanerBooking.findFirstOrThrow({
      where: { tenant_id: tenant.tenantId, workshop_order_id: order.id },
    });
    expect(booking.status).toBe('RESERVED');
    expect(booking.loaner_vehicle_id).toBe(loanerVehicleId);
    expect(booking.planned_from.toISOString()).toBe(intent.schedule!.start_at);

    expect(
      await prisma.workshopCommandSession.findFirst({
        where: { tenant_id: tenant.tenantId, command_id: intent.command_id },
      }),
    ).toBeNull();

    const afterDecision = await interpret({
      command_id: intent.command_id,
      text: FULL_SENTENCE,
    }).expect(409);
    expect(afterDecision.body.code).toBe('COMMAND_ID_REUSED');
  });

  it('refuses to propose while the platform policy is disabled', async () => {
    const intent = await interpretReady();

    const response = await propose(intent.command_id).expect(422);
    expect(response.body.message).toContain('PROPOSE');
    expect(
      await prisma.agentProposal.count({
        where: { tenant_id: tenant.tenantId, command_id: intent.command_id },
      }),
    ).toBe(0);
  });

  it('returns 404 when proposing a command that was never interpreted', async () => {
    const response = await propose(newCommandId()).expect(404);
    expect(response.body.code).toBe('SESSION_NOT_FOUND');
  });

  it('forbids sales from proposing but lets them interpret without the loaner', async () => {
    const salesToken = await createSalesCaller();

    const proposal = await request(app.getHttpServer())
      .post(PROPOSE_PATH)
      .set('Authorization', salesToken)
      .send({ contract_version: CONTRACT_VERSION, command_id: newCommandId() })
      .expect(403);
    expect(proposal.status).toBe(403);

    const commandId = newCommandId();
    const withLoaner = await request(app.getHttpServer())
      .post(INTERPRET_PATH)
      .set('Authorization', salesToken)
      .send({
        contract_version: CONTRACT_VERSION,
        command_id: commandId,
        source: 'keyboard',
        locale: 'de-AT',
        text: FULL_SENTENCE,
      })
      .expect(200);
    expect(withLoaner.body.status).toBe('clarification');
    expect(withLoaner.body.code).toBe('LOANER_NOT_PERMITTED');
    expect(withLoaner.body.choices).toEqual([
      expect.objectContaining({
        slot: 'loaner',
        value: 'continue_without_loaner',
      }),
    ]);

    const withoutLoaner = await request(app.getHttpServer())
      .post(INTERPRET_PATH)
      .set('Authorization', salesToken)
      .send({
        contract_version: CONTRACT_VERSION,
        command_id: commandId,
        source: 'keyboard',
        locale: 'de-AT',
        text: FULL_SENTENCE,
        selections: [{ slot: 'loaner', value: 'continue_without_loaner' }],
      })
      .expect(200);
    expect(withoutLoaner.body.status).toBe('ready');
    expect(withoutLoaner.body.loaner.requested).toBe(false);
    expect(withoutLoaner.body.loaner.loaner_vehicle_id).toBeNull();
  });

  it('refuses to propose directly when the last interpret ended in a clarification', async () => {
    await enableBookingPolicy();
    const secondCustomer = await prisma.customer.create({
      data: {
        tenant_id: tenant.tenantId,
        first_name: 'Max',
        last_name: 'Huber',
        type: 'PRIVATE',
      },
    });
    const commandId = newCommandId();
    const clarificationRes = await interpret({
      command_id: commandId,
      text: FULL_SENTENCE,
    }).expect(200);
    expect(clarificationRes.body.status).toBe('clarification');

    const directPropose = await propose(commandId, [
      { slot: 'customer_id', value: customerId },
      { slot: 'vehicle_id', value: golfId },
    ]).expect(409);

    expect(directPropose.body.code).toBe('PLAN_STALE');
  });

  describe('HTTP role matrix authorization (403 for unauthorized roles)', () => {
    const TRANSCRIBE_PATH = '/api/voice-translation/transcribe';

    const unauthorizedRoles: TenantMemberRole[] = ['TECH', 'DEMO'];
    it.each(unauthorizedRoles)(
      'forbids %s from interpret, propose, and transcribe',
      async (role) => {
        const callerToken = await createCallerWithRole(role);

        await request(app.getHttpServer())
          .post(INTERPRET_PATH)
          .set('Authorization', callerToken)
          .send({
            contract_version: CONTRACT_VERSION,
            command_id: newCommandId(),
            source: 'keyboard',
            locale: 'de-AT',
            text: FULL_SENTENCE,
          })
          .expect(403);

        await request(app.getHttpServer())
          .post(PROPOSE_PATH)
          .set('Authorization', callerToken)
          .send({
            contract_version: CONTRACT_VERSION,
            command_id: newCommandId(),
          })
          .expect(403);

        await request(app.getHttpServer())
          .post(TRANSCRIBE_PATH)
          .set('Authorization', callerToken)
          .attach(
            'audio',
            Buffer.from('fake-audio-bytes-for-test'),
            'test.webm',
          )
          .expect(403);
      },
    );

    it('forbids tenant API key principals from interpret, propose, and transcribe', async () => {
      const apiKeyToken = await createApiKeyCaller();

      await request(app.getHttpServer())
        .post(INTERPRET_PATH)
        .set('Authorization', apiKeyToken)
        .send({
          contract_version: CONTRACT_VERSION,
          command_id: newCommandId(),
          source: 'keyboard',
          locale: 'de-AT',
          text: FULL_SENTENCE,
        })
        .expect(403);

      await request(app.getHttpServer())
        .post(PROPOSE_PATH)
        .set('Authorization', apiKeyToken)
        .send({
          contract_version: CONTRACT_VERSION,
          command_id: newCommandId(),
        })
        .expect(403);

      await request(app.getHttpServer())
        .post(TRANSCRIBE_PATH)
        .set('Authorization', apiKeyToken)
        .attach('audio', Buffer.from('fake-audio-bytes-for-test'), 'test.webm')
        .expect(403);
    });
  });

  it('fails the competing proposal when the bay is taken at apply time', async () => {
    await enableBookingPolicy();
    const first = await interpretReady({ text: FULL_SENTENCE });
    const second = await interpretReady({
      text: NO_LOANER_SENTENCE.replace('Huber Golf', 'Huber Polo'),
    });

    expect(first.vehicle_id).toBe(golfId);
    expect(second.vehicle_id).toBe(poloId);

    const firstProposal = await propose(first.command_id).expect(201);
    const secondProposal = await propose(second.command_id).expect(201);

    await request(app.getHttpServer())
      .post(
        `/api/agent-proposals/${firstProposal.body.pending_action_id}/apply`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const conflict = await request(app.getHttpServer())
      .post(
        `/api/agent-proposals/${secondProposal.body.pending_action_id}/apply`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);
    expect(conflict.body.message).toMatch(/Bay is already occupied/);

    const stored = await prisma.agentProposal.findFirstOrThrow({
      where: {
        tenant_id: tenant.tenantId,
        id: secondProposal.body.pending_action_id,
      },
    });
    expect(stored.status).toBe('FAILED');
    expect(stored.reason).toMatch(/Bay is already occupied/);
    expect(
      await prisma.workshopOrder.count({
        where: { tenant_id: tenant.tenantId, vehicle_id: poloId },
      }),
    ).toBe(0);

    const retried = await request(app.getHttpServer())
      .post(
        `/api/agent-proposals/${secondProposal.body.pending_action_id}/apply`,
      )
      .set('Authorization', `Bearer ${authToken}`)
      .expect(409);
    expect(retried.body.message).toContain('FAILED');
  });

  it('refuses a second proposal after the first one was rejected', async () => {
    await enableBookingPolicy();
    const intent = await interpretReady();
    const created = await propose(intent.command_id).expect(201);

    await request(app.getHttpServer())
      .post(`/api/agent-proposals/${created.body.pending_action_id}/reject`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reason: 'Test rejection' })
      .expect(200);

    expect(
      await prisma.workshopCommandSession.findFirst({
        where: { tenant_id: tenant.tenantId, command_id: intent.command_id },
      }),
    ).toBeNull();

    const retried = await propose(intent.command_id).expect(409);
    expect(retried.body.code).toBe('COMMAND_ID_REUSED');
  });

  it('deletes the replay row when a lapsed proposal expires on apply', async () => {
    await enableBookingPolicy();
    const intent = await interpretReady();
    const created = await propose(intent.command_id).expect(201);

    await prisma.agentProposal.updateMany({
      where: {
        tenant_id: tenant.tenantId,
        id: created.body.pending_action_id,
      },
      data: { expires_at: new Date(Date.now() - 60_000) },
    });
    await request(app.getHttpServer())
      .post(`/api/agent-proposals/${created.body.pending_action_id}/apply`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(422);

    const stored = await prisma.agentProposal.findFirstOrThrow({
      where: {
        tenant_id: tenant.tenantId,
        id: created.body.pending_action_id,
      },
    });
    expect(stored.status).toBe('EXPIRED');
    expect(
      await prisma.workshopCommandSession.findFirst({
        where: { tenant_id: tenant.tenantId, command_id: intent.command_id },
      }),
    ).toBeNull();
  });

  it('purges a lapsed replay row for a tenant that stops using the command box', async () => {
    const intent = await interpretReady();

    await prisma.workshopCommandSession.updateMany({
      where: { tenant_id: tenant.tenantId, command_id: intent.command_id },
      data: { expires_at: new Date(Date.now() - 60_000) },
    });
    await expect(
      app.get(WorkshopCommandSessionRetentionService).run(),
    ).resolves.toBe(true);

    expect(
      await prisma.workshopCommandSession.findFirst({
        where: { tenant_id: tenant.tenantId, command_id: intent.command_id },
      }),
    ).toBeNull();
  });
});

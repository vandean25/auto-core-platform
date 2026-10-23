import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { viennaIsoDay } from '../src/vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import { bootstrapE2eApp, createE2eTenant } from './helpers/e2e-suite.js';
import { cleanupTestTenantGraph } from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

describe('Vehicle parties (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenantA: Awaited<ReturnType<typeof createE2eTenant>>;
  let tenantB: Awaited<ReturnType<typeof createE2eTenant>>;
  let seq = 0;

  const today = viennaIsoDay(new Date());
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const monthAgo = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  beforeAll(async () => {
    ({ app, basePrisma } = await bootstrapE2eApp());
    tenantA = await createE2eTenant(app, basePrisma, 'aut641-party-a');
    tenantB = await createE2eTenant(app, basePrisma, 'aut641-party-b');
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(basePrisma, tenantA.tenantId);
    await cleanupTestTenantGraph(basePrisma, tenantB.tenantId);
    await teardownTestApp(app, basePrisma);
  });

  async function newCustomer(tenant: typeof tenantA, label: string) {
    seq += 1;
    return tenant.prisma.customer.create({
      data: {
        tenant_id: tenant.tenantId,
        first_name: label,
        last_name: `Synthetic${seq}`,
        email: `aut641-${seq}-${Date.now()}@example.com`,
      },
    });
  }

  async function newVehicle(tenant: typeof tenantA, customerId?: string) {
    seq += 1;
    return tenant.prisma.vehicle.create({
      data: {
        tenant_id: tenant.tenantId,
        make: 'Synthetic',
        model: 'Car',
        year: 2020,
        vin: `AUT641${String(seq).padStart(11, '0')}`,
        customer_id: customerId ?? null,
      },
    });
  }

  const api = (tenant: typeof tenantA) => ({
    get: (url: string) =>
      request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${tenant.authToken}`),
    post: (url: string) =>
      request(app.getHttpServer())
        .post(url)
        .set('Authorization', `Bearer ${tenant.authToken}`),
    patch: (url: string) =>
      request(app.getHttpServer())
        .patch(url)
        .set('Authorization', `Bearer ${tenant.authToken}`),
  });

  async function vehicleContactOf(vehicleId: string) {
    return (
      await tenantA.prisma.vehicle.findFirstOrThrow({
        where: { id: vehicleId, tenant_id: tenantA.tenantId },
      })
    ).customer_id;
  }

  /** OWNER rows active today (half-open interval), not merely open-ended ones. */
  async function activeOwners(vehicleId: string) {
    const rows = await tenantA.prisma.vehicleParty.findMany({
      where: {
        tenant_id: tenantA.tenantId,
        vehicle_id: vehicleId,
        role: 'OWNER',
      },
    });
    const day = (value: Date | null) => value?.toISOString().slice(0, 10);
    return rows.filter(
      (row) =>
        (day(row.valid_from) ?? '') <= today &&
        (day(row.valid_to) ?? '9999-12-31') > today,
    );
  }

  describe('customer_id sync in both directions', () => {
    it('adding an OWNER updates Vehicle.customer_id; ending the owner never clears it', async () => {
      const [alice, vehicle] = [
        await newCustomer(tenantA, 'Alice'),
        await newVehicle(tenantA),
      ];

      const created = await api(tenantA)
        .post(`/api/vehicles/${vehicle.id}/parties`)
        .send({ customer_id: alice.id, role: 'OWNER', valid_from: yearAgo })
        .expect(201);
      expect(created.body).toMatchObject({
        role: 'OWNER',
        source: 'MANUAL',
        is_active: true,
      });
      const afterAdd = await tenantA.prisma.vehicle.findFirstOrThrow({
        where: { id: vehicle.id, tenant_id: tenantA.tenantId },
      });
      expect(afterAdd.customer_id).toBe(alice.id);

      await api(tenantA)
        .patch(`/api/vehicles/${vehicle.id}/parties/${created.body.id}`)
        .send({ valid_to: today })
        .expect(200);
      const afterEnd = await tenantA.prisma.vehicle.findFirstOrThrow({
        where: { id: vehicle.id, tenant_id: tenantA.tenantId },
      });
      expect(afterEnd.customer_id).toBe(alice.id);
    });

    it('PATCH customer_id ends the old OWNER and creates the new OWNER; null ends the OWNER only', async () => {
      const alice = await newCustomer(tenantA, 'Alice');
      const bob = await newCustomer(tenantA, 'Bob');
      const vehicle = await newVehicle(tenantA);
      await api(tenantA)
        .post(`/api/vehicles/${vehicle.id}/parties`)
        .send({ customer_id: alice.id, role: 'OWNER', valid_from: yearAgo })
        .expect(201);

      await api(tenantA)
        .patch(`/api/vehicles/${vehicle.id}`)
        .send({ customer_id: bob.id })
        .expect(200);

      const afterChange = await api(tenantA)
        .get(`/api/vehicles/${vehicle.id}/parties`)
        .expect(200);
      const owners = afterChange.body.data.filter(
        (party: { role: string }) => party.role === 'OWNER',
      );
      expect(owners).toHaveLength(2);
      const aliceRow = owners.find(
        (party: { customer_id: string }) => party.customer_id === alice.id,
      );
      const bobRow = owners.find(
        (party: { customer_id: string }) => party.customer_id === bob.id,
      );
      expect(aliceRow).toMatchObject({ valid_to: today, is_active: false });
      expect(bobRow).toMatchObject({
        valid_from: today,
        valid_to: null,
        is_active: true,
        source: 'MANUAL',
      });
      const reloaded = await tenantA.prisma.vehicle.findFirstOrThrow({
        where: { id: vehicle.id, tenant_id: tenantA.tenantId },
      });
      expect(reloaded.customer_id).toBe(bob.id);

      await api(tenantA)
        .patch(`/api/vehicles/${vehicle.id}`)
        .send({ customer_id: null })
        .expect(200);
      const cleared = await tenantA.prisma.vehicle.findFirstOrThrow({
        where: { id: vehicle.id, tenant_id: tenantA.tenantId },
      });
      expect(cleared.customer_id).toBeNull();
      expect(await activeOwners(vehicle.id)).toHaveLength(0);
      const parties = await tenantA.prisma.vehicleParty.findMany({
        where: { tenant_id: tenantA.tenantId, vehicle_id: vehicle.id },
      });
      // Bob started today, so clearing the contact withdraws that same-day row; Alice's history stays.
      expect(parties).toHaveLength(1);
    });

    it('keeps one active OWNER and no future-dated OWNER across several same-day changes', async () => {
      const [alice, bob, carol, dave] = [
        await newCustomer(tenantA, 'Alice'),
        await newCustomer(tenantA, 'Bob'),
        await newCustomer(tenantA, 'Carol'),
        await newCustomer(tenantA, 'Dave'),
      ];
      const vehicle = await newVehicle(tenantA);
      await api(tenantA)
        .post(`/api/vehicles/${vehicle.id}/parties`)
        .send({ customer_id: alice.id, role: 'OWNER', valid_from: yearAgo })
        .expect(201);

      for (const customer of [bob, carol, dave]) {
        await api(tenantA)
          .patch(`/api/vehicles/${vehicle.id}`)
          .send({ customer_id: customer.id })
          .expect(200);
        const owners = await activeOwners(vehicle.id);
        expect(owners.map((owner) => owner.customer_id)).toEqual([customer.id]);
        expect(await vehicleContactOf(vehicle.id)).toBe(customer.id);
      }

      const rows = await tenantA.prisma.vehicleParty.findMany({
        where: { tenant_id: tenantA.tenantId, vehicle_id: vehicle.id },
      });
      // Alice (ended today) and one same-day OWNER; the intermediate ones were corrected in place.
      expect(rows).toHaveLength(2);
      expect(
        rows.every((row) => (row.valid_from?.toISOString().slice(0, 10) ?? '') <= today),
      ).toBe(true);

      await api(tenantA)
        .patch(`/api/vehicles/${vehicle.id}`)
        .send({ customer_id: null })
        .expect(200);
      expect(await activeOwners(vehicle.id)).toHaveLength(0);
      expect(await vehicleContactOf(vehicle.id)).toBeNull();
    });

    it('does not invent a party when PATCH repeats the current customer', async () => {
      const alice = await newCustomer(tenantA, 'Alice');
      const vehicle = await newVehicle(tenantA, alice.id);

      await api(tenantA)
        .patch(`/api/vehicles/${vehicle.id}`)
        .send({ customer_id: alice.id })
        .expect(200);

      expect(
        await tenantA.prisma.vehicleParty.count({
          where: { tenant_id: tenantA.tenantId, vehicle_id: vehicle.id },
        }),
      ).toBe(0);
    });

    it('starts the first OWNER when a vehicle is created with a customer', async () => {
      const alice = await newCustomer(tenantA, 'Alice');
      const created = await api(tenantA)
        .post('/api/vehicles')
        .send({ make: 'Synthetic', model: 'Car', year: 2021, customer_id: alice.id })
        .expect(201);
      const parties = await tenantA.prisma.vehicleParty.findMany({
        where: { tenant_id: tenantA.tenantId, vehicle_id: created.body.id },
      });
      expect(parties).toHaveLength(1);
      expect(parties[0]).toMatchObject({
        customer_id: alice.id,
        role: 'OWNER',
        source: 'MANUAL',
        valid_to: null,
      });
      expect(await vehicleContactOf(created.body.id)).toBe(alice.id);
    });
  });

  describe('invariants', () => {
    it('rejects an overlapping OWNER with 409 and keeps history', async () => {
      const [alice, bob, vehicle] = [
        await newCustomer(tenantA, 'Alice'),
        await newCustomer(tenantA, 'Bob'),
        await newVehicle(tenantA),
      ];
      await api(tenantA)
        .post(`/api/vehicles/${vehicle.id}/parties`)
        .send({ customer_id: alice.id, role: 'OWNER', valid_from: yearAgo })
        .expect(201);

      const conflict = await api(tenantA)
        .post(`/api/vehicles/${vehicle.id}/parties`)
        .send({ customer_id: bob.id, role: 'OWNER' })
        .expect(409);
      expect(conflict.body.code).toBe('VEHICLE_PARTY_OVERLAP');
      expect(conflict.body.message).toContain('overlaps');

      const adjacent = await api(tenantA)
        .post(`/api/vehicles/${vehicle.id}/parties`)
        .send({
          customer_id: bob.id,
          role: 'PREVIOUS_OWNER',
          valid_to: yearAgo,
        })
        .expect(201);
      expect(adjacent.body.role).toBe('PREVIOUS_OWNER');
    });

    it('rejects PREVIOUS_OWNER without valid_to and a future-dated OWNER', async () => {
      const [alice, vehicle] = [
        await newCustomer(tenantA, 'Alice'),
        await newVehicle(tenantA),
      ];
      const missingEnd = await api(tenantA)
        .post(`/api/vehicles/${vehicle.id}/parties`)
        .send({ customer_id: alice.id, role: 'PREVIOUS_OWNER' })
        .expect(422);
      expect(missingEnd.body.code).toBe('VEHICLE_PARTY_PREVIOUS_OWNER_END_REQUIRED');
      expect(missingEnd.body.message).toContain('PREVIOUS_OWNER requires valid_to');

      const future = await api(tenantA)
        .post(`/api/vehicles/${vehicle.id}/parties`)
        .send({
          customer_id: alice.id,
          role: 'OWNER',
          valid_from: '2999-01-01',
        })
        .expect(422);
      expect(future.body.code).toBe('VEHICLE_PARTY_FUTURE_START_UNSUPPORTED');
      expect(future.body.message).toContain('future valid_from');
    });

    it('suggests BILL_TO over LEASING, and never the owner or driver', async () => {
      const [owner, driver, leasing, payer, vehicle] = [
        await newCustomer(tenantA, 'Owner'),
        await newCustomer(tenantA, 'Driver'),
        await newCustomer(tenantA, 'Leasing'),
        await newCustomer(tenantA, 'Payer'),
        await newVehicle(tenantA),
      ];
      const add = (customer_id: string, role: string) =>
        api(tenantA)
          .post(`/api/vehicles/${vehicle.id}/parties`)
          .send({ customer_id, role, valid_from: monthAgo })
          .expect(201);

      await add(owner.id, 'OWNER');
      await add(driver.id, 'DRIVER');
      const none = await api(tenantA)
        .get(`/api/vehicles/${vehicle.id}/parties`)
        .expect(200);
      expect(none.body.suggested_bill_to).toBeNull();

      await add(leasing.id, 'LEASING');
      const leasingOnly = await api(tenantA)
        .get(`/api/vehicles/${vehicle.id}/parties`)
        .expect(200);
      expect(leasingOnly.body.suggested_bill_to).toMatchObject({
        customer_id: leasing.id,
        role: 'LEASING',
      });

      await add(payer.id, 'BILL_TO');
      const billTo = await api(tenantA)
        .get(`/api/vehicles/${vehicle.id}/parties`)
        .expect(200);
      expect(billTo.body.suggested_bill_to).toMatchObject({
        customer_id: payer.id,
        role: 'BILL_TO',
      });
    });
  });

  describe('row-lock concurrency', () => {
    it('two parallel OWNER adds leave exactly one active OWNER and a consistent customer_id', async () => {
      const [alice, bob, vehicle] = [
        await newCustomer(tenantA, 'Alice'),
        await newCustomer(tenantA, 'Bob'),
        await newVehicle(tenantA),
      ];

      const responses = await Promise.all(
        [alice, bob].map((customer) =>
          api(tenantA)
            .post(`/api/vehicles/${vehicle.id}/parties`)
            .send({ customer_id: customer.id, role: 'OWNER', valid_from: monthAgo }),
        ),
      );

      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      const owners = await activeOwners(vehicle.id);
      expect(owners).toHaveLength(1);
      const reloaded = await tenantA.prisma.vehicle.findFirstOrThrow({
        where: { id: vehicle.id, tenant_id: tenantA.tenantId },
      });
      expect(reloaded.customer_id).toBe(owners[0].customer_id);
    });

    it('two parallel customer changes leave exactly one active OWNER and a consistent customer_id', async () => {
      const [alice, bob, carol, vehicle] = [
        await newCustomer(tenantA, 'Alice'),
        await newCustomer(tenantA, 'Bob'),
        await newCustomer(tenantA, 'Carol'),
        await newVehicle(tenantA),
      ];
      await api(tenantA)
        .post(`/api/vehicles/${vehicle.id}/parties`)
        .send({ customer_id: alice.id, role: 'OWNER', valid_from: yearAgo })
        .expect(201);

      const responses = await Promise.all(
        [bob, carol].map((customer) =>
          api(tenantA)
            .patch(`/api/vehicles/${vehicle.id}`)
            .send({ customer_id: customer.id }),
        ),
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const owners = await activeOwners(vehicle.id);
      expect(owners).toHaveLength(1);
      const reloaded = await tenantA.prisma.vehicle.findFirstOrThrow({
        where: { id: vehicle.id, tenant_id: tenantA.tenantId },
      });
      expect(reloaded.customer_id).toBe(owners[0].customer_id);
    });
  });

  describe('database backstops', () => {
    it('rejects a second open-ended OWNER, BILL_TO or LEASING inserted directly', async () => {
      const [a, b, vehicle] = [
        await newCustomer(tenantA, 'A'),
        await newCustomer(tenantA, 'B'),
        await newVehicle(tenantA),
      ];
      for (const role of ['OWNER', 'BILL_TO', 'LEASING'] as const) {
        await tenantA.prisma.vehicleParty.create({
          data: {
            tenant_id: tenantA.tenantId,
            vehicle_id: vehicle.id,
            customer_id: a.id,
            role,
          },
        });
        await expect(
          tenantA.prisma.vehicleParty.create({
            data: {
              tenant_id: tenantA.tenantId,
              vehicle_id: vehicle.id,
              customer_id: b.id,
              role,
            },
          }),
        ).rejects.toMatchObject({ code: 'P2002' });
      }
    });

    it('allows several open-ended DRIVER rows and rejects an inverted interval', async () => {
      const [a, b, vehicle] = [
        await newCustomer(tenantA, 'A'),
        await newCustomer(tenantA, 'B'),
        await newVehicle(tenantA),
      ];
      for (const customer of [a, b]) {
        await tenantA.prisma.vehicleParty.create({
          data: {
            tenant_id: tenantA.tenantId,
            vehicle_id: vehicle.id,
            customer_id: customer.id,
            role: 'DRIVER',
          },
        });
      }
      await expect(
        tenantA.prisma.vehicleParty.create({
          data: {
            tenant_id: tenantA.tenantId,
            vehicle_id: vehicle.id,
            customer_id: a.id,
            role: 'INSURANCE',
            valid_from: new Date('2026-06-01'),
            valid_to: new Date('2026-01-01'),
          },
        }),
      ).rejects.toThrow(/vehicle_parties_valid_interval_check/);
    });

    it('rejects a duplicate (vehicle, type, external_ref) notice but allows the same ref on another vehicle', async () => {
      const [v1, v2] = [await newVehicle(tenantA), await newVehicle(tenantA)];
      const notice = (vehicleId: string) =>
        tenantA.prisma.vehicleNotice.create({
          data: {
            tenant_id: tenantA.tenantId,
            vehicle_id: vehicleId,
            type: 'SERVICE_DUE',
            title: 'Service',
            external_ref: 'SERVICE-001',
          },
        });
      await notice(v1.id);
      await expect(notice(v1.id)).rejects.toMatchObject({ code: 'P2002' });
      await expect(notice(v2.id)).resolves.toBeDefined();
    });
  });

  describe('tenant isolation', () => {
    it('rejects parties and notices that point at another tenant', async () => {
      const [customerA, vehicleA] = [
        await newCustomer(tenantA, 'A'),
        await newVehicle(tenantA),
      ];
      const [customerB, vehicleB] = [
        await newCustomer(tenantB, 'B'),
        await newVehicle(tenantB),
      ];

      await expect(
        tenantA.prisma.vehicleParty.create({
          data: {
            tenant_id: tenantA.tenantId,
            vehicle_id: vehicleB.id,
            customer_id: customerA.id,
            role: 'DRIVER',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(
        tenantA.prisma.vehicleParty.create({
          data: {
            tenant_id: tenantA.tenantId,
            vehicle_id: vehicleA.id,
            customer_id: customerB.id,
            role: 'DRIVER',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
      await expect(
        tenantA.prisma.vehicleNotice.create({
          data: {
            tenant_id: tenantA.tenantId,
            vehicle_id: vehicleB.id,
            type: 'REMARK',
            title: 'Cross tenant',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it('rejects a notice resolved by another tenant workshop order', async () => {
      const vehicleA = await newVehicle(tenantA);
      const vehicleB = await newVehicle(tenantB);
      const siteB = await tenantB.prisma.site.findFirstOrThrow({
        where: { tenant_id: tenantB.tenantId },
      });
      const orderB = await tenantB.prisma.workshopOrder.create({
        data: {
          tenant_id: tenantB.tenantId,
          site_id: siteB.id,
          vehicle_id: vehicleB.id,
          order_number: `AUT641-WO-${Date.now()}`,
          odometer: 1,
          fuel_level: 50,
        },
      });

      await expect(
        tenantA.prisma.vehicleNotice.create({
          data: {
            tenant_id: tenantA.tenantId,
            vehicle_id: vehicleA.id,
            type: 'REMARK',
            title: 'Cross tenant order',
            resolved_workshop_order_id: orderB.id,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2003' });
    });

    it("hides another tenant's vehicle parties", async () => {
      const vehicleB = await newVehicle(tenantB);
      await api(tenantA)
        .get(`/api/vehicles/${vehicleB.id}/parties`)
        .expect(404);
      const customerA = await newCustomer(tenantA, 'A');
      await api(tenantA)
        .post(`/api/vehicles/${vehicleB.id}/parties`)
        .send({ customer_id: customerA.id, role: 'DRIVER' })
        .expect(404);
    });

    it("rejects a party for another tenant's customer through the API", async () => {
      const vehicleA = await newVehicle(tenantA);
      const customerB = await newCustomer(tenantB, 'B');
      await api(tenantA)
        .post(`/api/vehicles/${vehicleA.id}/parties`)
        .send({ customer_id: customerB.id, role: 'DRIVER' })
        .expect(404);
    });
  });
});

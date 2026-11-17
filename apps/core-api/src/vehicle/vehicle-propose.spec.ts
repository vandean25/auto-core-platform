import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  applyVehicleCreateProposal,
  applyVehicleUpdateProposal,
  enrichVehicleCreateProposal,
  enrichVehicleUpdateProposal,
} from './vehicle-propose.js';
import {
  proposeVehicleCreateInputSchema,
  proposeVehicleUpdateInputSchema,
} from './vehicle-propose.schema.js';
import { DryRunChangeCollector } from '../dry-run/dry-run-change-collector.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { VEHICLE_IDENTITY_RESET } from './vehicle-identity.util.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000010';
const VEHICLE_ID = '00000000-0000-4000-8000-000000000020';
const OTHER_VEHICLE_ID = '00000000-0000-4000-8000-000000000021';
const VALID_VIN = '1HGCM82633A004352';
const NON_ISO_CHECK_DIGIT_VIN = 'WVWZZZ1KZAW123456';

function createMockPrisma(overrides: Record<string, unknown> = {}) {
  const tx = {
    vehicle: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: null,
        mileage: 45000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: jest.fn().mockResolvedValue({
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: CUSTOMER_ID,
        mileage: 45000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      }),
    },
    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: CUSTOMER_ID }),
    },
    vehicleParty: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({ id: 'party-1' }),
    },
    ...overrides,
  };
  return {
    ...tx,
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
}

describe('vehicle-propose (AUT-614)', () => {
  describe('schema forbidden fields', () => {
    it.each([
      'variant',
      'inventory_role',
      'stock_status',
      'tax_scheme',
      'stock_received_at',
      'stock_cost_basis',
      'listings',
      'valuation_snapshots',
      'inspection_records',
      'purchases',
      'sales',
    ])('rejects forbidden field %s on propose_vehicle_create', (field) => {
      const parsed = proposeVehicleCreateInputSchema.safeParse({
        make: 'VW',
        model: 'Golf',
        year: 2022,
        idempotency_key: 'k1',
        [field]: 'forbidden',
      });
      expect(parsed.success).toBe(false);
    });

    it.each([
      'variant',
      'inventory_role',
      'stock_status',
      'tax_scheme',
      'listings',
    ])(
      'rejects forbidden field %s on propose_vehicle_update changes',
      (field) => {
        const parsed = proposeVehicleUpdateInputSchema.safeParse({
          vehicle_id: VEHICLE_ID,
          changes: { make: 'Audi', [field]: 'forbidden' },
          reason: 'Correction',
          idempotency_key: 'k2',
        });
        expect(parsed.success).toBe(false);
      },
    );

    it('rejects propose_vehicle_create when both year and first_registration_date are missing', async () => {
      const prisma = createMockPrisma();
      await expect(
        enrichVehicleCreateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          {
            make: 'VW',
            model: 'Golf',
            idempotency_key: 'k-no-year',
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('derives year from first_registration_date when year is omitted', async () => {
      const prisma = createMockPrisma();
      const payload = await enrichVehicleCreateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          make: 'VW',
          model: 'Golf',
          first_registration_date: '2019-06-15',
          idempotency_key: 'k-derive-year',
        },
      );
      expect(payload.fields.year).toBe(2019);
    });
  });

  describe('VIN validation and plate normalization', () => {
    it('rejects an invalid 17-char VIN format', async () => {
      const prisma = createMockPrisma();
      await expect(
        enrichVehicleCreateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          {
            make: 'VW',
            model: 'Golf',
            year: 2022,
            vin: 'INVALID_VIN_TOO_SHORT',
            idempotency_key: 'k1',
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a VIN containing forbidden characters I, O, or Q', async () => {
      const prisma = createMockPrisma();
      await expect(
        enrichVehicleCreateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          {
            make: 'VW',
            model: 'Golf',
            year: 2022,
            vin: '1HGCM82633A00435I',
            idempotency_key: 'k1',
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('warns when VIN check digit does not validate (European VIN)', async () => {
      const prisma = createMockPrisma();
      const payload = await enrichVehicleCreateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          make: 'VW',
          model: 'Golf',
          year: 2022,
          vin: NON_ISO_CHECK_DIGIT_VIN,
          plate: 'W-12345 A',
          idempotency_key: 'k1',
        },
      );
      expect(payload.fields.vin).toBe(NON_ISO_CHECK_DIGIT_VIN);
      expect(payload.fields.plate).toBe('W12345A');
      expect(payload.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/check digit/i)]),
      );
    });

    it.each([
      ['W-12345 A', 'W12345A'],
      ['gf 123 ab', 'GF123AB'],
      ['BN.999-XY', 'BN999XY'],
    ])('normalizes Austrian plate %s to %s', async (raw, expected) => {
      const prisma = createMockPrisma();
      const payload = await enrichVehicleCreateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          make: 'VW',
          model: 'Golf',
          year: 2022,
          plate: raw,
          idempotency_key: 'k-plate',
        },
      );
      expect(payload.fields.plate).toBe(expected);
    });
  });

  describe('duplicate checks', () => {
    it('blocks create with DUPLICATE_VEHICLE on exact VIN match', async () => {
      const prisma = createMockPrisma();
      prisma.vehicle.findMany.mockResolvedValueOnce([
        {
          id: OTHER_VEHICLE_ID,
          vin: VALID_VIN,
          plate: 'W99999B',
          plate_normalized: 'W99999B',
          make: 'VW',
          model: 'Golf',
          customer_id: null,
          first_registration_date: null,
        },
      ]);

      await expect(
        enrichVehicleCreateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          {
            make: 'VW',
            model: 'Golf',
            year: 2022,
            vin: VALID_VIN,
            idempotency_key: 'k-dup-vin',
          },
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('warns and returns candidate on exact normalized plate match without blocking', async () => {
      const prisma = createMockPrisma();
      prisma.vehicle.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
        if ('OR' in args.where || 'plate_normalized' in args.where) {
          return [
            {
              id: OTHER_VEHICLE_ID,
              vin: null,
              plate: 'W-12345 A',
              plate_normalized: 'W12345A',
              make: 'Audi',
              model: 'A4',
              customer_id: null,
              first_registration_date: null,
            },
          ];
        }
        return [];
      });

      const payload = await enrichVehicleCreateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          make: 'VW',
          model: 'Golf',
          year: 2022,
          plate: 'w 12345-a',
          idempotency_key: 'k-dup-plate',
        },
      );

      expect(payload.duplicate_check.candidate_ids).toEqual([OTHER_VEHICLE_ID]);
      expect(payload.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/plate/i)]),
      );
    });

    it('warns and returns candidate on same make/model/first_registration_date for same owner', async () => {
      const prisma = createMockPrisma();
      prisma.vehicle.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => {
        if ('customer_id' in args.where) {
          return [
            {
              id: OTHER_VEHICLE_ID,
              vin: null,
              plate: null,
              plate_normalized: null,
              make: 'VW',
              model: 'Golf',
              customer_id: CUSTOMER_ID,
              first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
            },
          ];
        }
        return [];
      });

      const payload = await enrichVehicleCreateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          owner_customer_id: CUSTOMER_ID,
          make: 'VW',
          model: 'Golf',
          first_registration_date: '2021-05-10',
          idempotency_key: 'k-dup-owner',
        },
      );

      expect(payload.duplicate_check.candidate_ids).toEqual([OTHER_VEHICLE_ID]);
      expect(payload.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/make.*model/i)]),
      );
    });
  });

  describe('mileage decrease rules', () => {
    it('rejects mileage decrease when no reason is given', async () => {
      const prisma = createMockPrisma();
      prisma.vehicle.findFirst.mockResolvedValue({
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: CUSTOMER_ID,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      });

      await expect(
        enrichVehicleUpdateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          {
            vehicle_id: VEHICLE_ID,
            changes: { mileage_km: 42000 },
            idempotency_key: 'k-mileage-no-reason',
          },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('flags mileage decrease as a warning in diff when reason is provided', async () => {
      const prisma = createMockPrisma();
      prisma.vehicle.findFirst.mockResolvedValue({
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: CUSTOMER_ID,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      });

      const payload = await enrichVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          vehicle_id: VEHICLE_ID,
          changes: { mileage_km: 42000 },
          reason: 'Typo corrected from 50000 to 42000',
          idempotency_key: 'k-mileage-reason',
        },
      );

      expect(payload.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/mileage.*decreas/i)]),
      );
      const outcome = await applyVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        payload,
      );
      expect(outcome.diff).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'mileage_km',
            before: '50000',
            after: '42000',
            warning: expect.stringMatching(/decreas/i),
          }),
        ]),
      );
    });
  });

  describe('approval re-validation and owner linking', () => {
    it('re-validates VIN uniqueness on create approval', async () => {
      const prisma = createMockPrisma();
      const payload = await enrichVehicleCreateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          make: 'VW',
          model: 'Golf',
          year: 2022,
          vin: VALID_VIN,
          idempotency_key: 'k-reval-vin',
        },
      );

      prisma.vehicle.findMany.mockResolvedValueOnce([
        {
          id: OTHER_VEHICLE_ID,
          vin: VALID_VIN,
          plate: null,
          plate_normalized: null,
          make: 'VW',
          model: 'Golf',
          customer_id: null,
          first_registration_date: null,
        },
      ]);

      await expect(
        applyVehicleCreateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          payload,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('links owner only if customer still exists in tenant on create approval', async () => {
      const prisma = createMockPrisma();
      const payload = await enrichVehicleCreateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          owner_customer_id: CUSTOMER_ID,
          make: 'VW',
          model: 'Golf',
          year: 2022,
          idempotency_key: 'k-owner-gone',
        },
      );

      // Customer was deleted before approval
      prisma.customer.findFirst.mockResolvedValueOnce(null);

      const outcome = await applyVehicleCreateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        payload,
      );

      expect(prisma.vehicleParty.create).not.toHaveBeenCalled();
      expect(outcome.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/customer.*no longer/i)]),
      );
    });

    it('rejects stale update proposal if vehicle changed since proposal', async () => {
      const prisma = createMockPrisma();
      const original = {
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: CUSTOMER_ID,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      };
      prisma.vehicle.findFirst.mockResolvedValueOnce(original);

      const payload = await enrichVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          vehicle_id: VEHICLE_ID,
          changes: { mileage_km: 55000 },
          reason: 'Service check-in',
          idempotency_key: 'k-stale',
        },
      );

      // Vehicle mileage changed before approval
      prisma.vehicle.findFirst.mockResolvedValueOnce({
        ...original,
        mileage: 52000,
      });

      await expect(
        applyVehicleUpdateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          payload,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when vehicle does not belong to tenant', async () => {
      const prisma = createMockPrisma();
      prisma.vehicle.findFirst.mockResolvedValueOnce(null);

      await expect(
        enrichVehicleUpdateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          {
            vehicle_id: VEHICLE_ID,
            changes: { make: 'Audi' },
            reason: 'Correction',
            idempotency_key: 'k-tenant',
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('clears brand and identity columns when VIN or plate changes', async () => {
      const prisma = createMockPrisma();
      const original = {
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: CUSTOMER_ID,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      };
      prisma.vehicle.findFirst.mockResolvedValue(original);

      const payload = await enrichVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          vehicle_id: VEHICLE_ID,
          changes: { plate: 'W-99999B' },
          reason: 'Plate reassigned',
          idempotency_key: 'k-plate-reset',
        },
      );

      await applyVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        payload,
      );

      expect(prisma.vehicle.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: VEHICLE_ID,
            tenant_id: TENANT_ID,
            plate: 'W12345A',
          }),
          data: expect.objectContaining({
            plate: 'W99999B',
            plate_normalized: 'W99999B',
            ...VEHICLE_IDENTITY_RESET,
            identity_resolution_token: null,
          }),
        }),
      );
    });

    it('throws NotFoundException when updateMany matches 0 rows because vehicle was deleted', async () => {
      const prisma = createMockPrisma();
      const original = {
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: CUSTOMER_ID,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      };
      prisma.vehicle.findFirst
        .mockResolvedValueOnce(original) // enrichVehicleUpdateProposal
        .mockResolvedValueOnce(original) // applyVehicleUpdateProposal pre-check
        .mockResolvedValueOnce(original) // persistVehicleUpdate tx re-read
        .mockResolvedValueOnce(null); // stillExists check after count === 0
      prisma.vehicle.updateMany.mockResolvedValueOnce({ count: 0 });

      const payload = await enrichVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          vehicle_id: VEHICLE_ID,
          changes: { mileage_km: 55000 },
          reason: 'Service check-in',
          idempotency_key: 'k-deleted-mid-tx',
        },
      );

      await expect(
        applyVehicleUpdateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          payload,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when updateMany matches 0 rows due to concurrent edit', async () => {
      const prisma = createMockPrisma();
      const original = {
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: CUSTOMER_ID,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      };
      prisma.vehicle.findFirst
        .mockResolvedValueOnce(original) // enrichVehicleUpdateProposal
        .mockResolvedValueOnce(original) // applyVehicleUpdateProposal pre-check
        .mockResolvedValueOnce(original) // persistVehicleUpdate tx re-read
        .mockResolvedValueOnce({ id: VEHICLE_ID }); // stillExists check after count === 0
      prisma.vehicle.updateMany.mockResolvedValueOnce({ count: 0 });

      const payload = await enrichVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          vehicle_id: VEHICLE_ID,
          changes: { mileage_km: 55000 },
          reason: 'Service check-in',
          idempotency_key: 'k-concurrent-edit',
        },
      );

      await expect(
        applyVehicleUpdateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          payload,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('leaves plate and identity untouched when echoing the current plate in display form', async () => {
      const prisma = createMockPrisma();
      const original = {
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W-12345 A',
        plate_normalized: 'W12345A',
        customer_id: CUSTOMER_ID,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      };
      prisma.vehicle.findFirst.mockResolvedValue(original);

      await expect(
        enrichVehicleUpdateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          {
            vehicle_id: VEHICLE_ID,
            changes: { plate: 'W-12345 A' },
            reason: 'No-op echo',
            idempotency_key: 'k-plate-echo-only',
          },
        ),
      ).rejects.toThrow(BadRequestException);

      const payload = await enrichVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          vehicle_id: VEHICLE_ID,
          changes: { plate: 'W 12345 A', make: 'Audi' },
          reason: 'Fix make only',
          idempotency_key: 'k-plate-echo-with-make',
        },
      );

      expect(payload.changes).toEqual({ make: 'Audi' });

      await applyVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        payload,
      );

      expect(prisma.vehicle.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { make: 'Audi' },
        }),
      );
    });

    it('requires reason and flags warning when clearing mileage_km to null', async () => {
      const prisma = createMockPrisma();
      const original = {
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: CUSTOMER_ID,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      };
      prisma.vehicle.findFirst.mockResolvedValue(original);

      await expect(
        enrichVehicleUpdateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          {
            vehicle_id: VEHICLE_ID,
            changes: { mileage_km: null },
            idempotency_key: 'k-mileage-null-no-reason',
          },
        ),
      ).rejects.toThrow(BadRequestException);

      const payload = await enrichVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          vehicle_id: VEHICLE_ID,
          changes: { mileage_km: null },
          reason: 'Odometer reading was entered in error',
          idempotency_key: 'k-mileage-null-with-reason',
        },
      );

      expect(payload.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/mileage.*decreas/i)]),
      );

      const outcome = await applyVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        payload,
      );

      expect(outcome.diff).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'mileage_km',
            before: '50000',
            after: null,
            warning: expect.stringMatching(/decreas/i),
          }),
        ]),
      );
    });

    it('records a Vehicle update in DryRunChangeCollector for scalar and owner updates', async () => {
      const prisma = createMockPrisma();
      const original = {
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: null,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      };
      prisma.vehicle.findFirst.mockResolvedValue(original);

      const payload = await enrichVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          vehicle_id: VEHICLE_ID,
          changes: { mileage_km: 42000, owner_customer_id: CUSTOMER_ID },
          reason: 'Cluster replaced',
          idempotency_key: 'k-dry-run-collector',
        },
      );

      const collector = new DryRunChangeCollector();
      await DryRunStorage.run(
        { isDryRun: true, tx: prisma as never, collector },
        () =>
          applyVehicleUpdateProposal(
            { prisma: prisma as never, tenantId: TENANT_ID },
            payload,
          ),
      );

      expect(collector.getChanges()).toEqual([
        {
          entity: 'Vehicle',
          id: VEHICLE_ID,
          op: 'update',
          provisional: false,
        },
      ]);
    });

    it('records Vehicle create on DryRunStorage collector when a dry run is active', async () => {
      const prisma = createMockPrisma();
      const payload = await enrichVehicleCreateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          owner_customer_id: CUSTOMER_ID,
          make: 'VW',
          model: 'Golf',
          year: 2021,
          vin: VALID_VIN,
          plate: 'W12345A',
          mileage_km: 45000,
          idempotency_key: 'k-dry-run-create-collector',
        },
      );

      const collector = new DryRunChangeCollector();
      await DryRunStorage.run(
        { isDryRun: true, tx: prisma as never, collector },
        () =>
          applyVehicleCreateProposal(
            { prisma: prisma as never, tenantId: TENANT_ID },
            payload,
          ),
      );

      expect(collector.getChanges()).toEqual([
        {
          entity: 'Vehicle',
          id: VEHICLE_ID,
          op: 'create',
          provisional: true,
        },
      ]);
    });

    it('omits owner_customer_id from diff when proposed owner no longer exists at apply time', async () => {
      const prisma = createMockPrisma();
      const original = {
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: VALID_VIN,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: null,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      };
      prisma.vehicle.findFirst.mockResolvedValue(original);
      prisma.customer.findFirst
        .mockResolvedValueOnce({ id: CUSTOMER_ID }) // propose time
        .mockResolvedValueOnce(null); // apply time: owner deleted

      const payload = await enrichVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        {
          vehicle_id: VEHICLE_ID,
          changes: { mileage_km: 51000, owner_customer_id: CUSTOMER_ID },
          reason: 'Service check-in',
          idempotency_key: 'k-missing-owner-at-apply',
        },
      );

      const outcome = await applyVehicleUpdateProposal(
        { prisma: prisma as never, tenantId: TENANT_ID },
        payload,
      );

      expect(outcome.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/owner link was skipped/i)]),
      );
      expect(outcome.diff).toEqual([
        { field: 'mileage_km', before: '50000', after: '51000' },
      ]);
    });

    it('tells caller to update the conflicting vehicle instead when update hits another VIN', async () => {
      const prisma = createMockPrisma();
      const original = {
        id: VEHICLE_ID,
        tenant_id: TENANT_ID,
        make: 'VW',
        model: 'Golf',
        year: 2021,
        vin: null,
        plate: 'W12345A',
        plate_normalized: 'W12345A',
        customer_id: null,
        mileage: 50000,
        fuel_type: 'DIESEL',
        national_code: null,
        first_registration_date: new Date('2021-05-10T00:00:00.000Z'),
      };
      prisma.vehicle.findFirst.mockResolvedValue(original);
      prisma.vehicle.findMany.mockResolvedValueOnce([
        {
          id: OTHER_VEHICLE_ID,
          vin: VALID_VIN,
          plate: 'W99999B',
          plate_normalized: 'W99999B',
          make: 'VW',
          model: 'Golf',
          customer_id: null,
          first_registration_date: null,
        },
      ]);

      await expect(
        enrichVehicleUpdateProposal(
          { prisma: prisma as never, tenantId: TENANT_ID },
          {
            vehicle_id: VEHICLE_ID,
            changes: { vin: VALID_VIN },
            reason: 'Add VIN',
            idempotency_key: 'k-update-vin-dup',
          },
        ),
      ).rejects.toThrow(/Update that vehicle instead/);
    });
  });
});

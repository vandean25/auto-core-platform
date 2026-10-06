import { afterEach } from '@jest/globals';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { calculateNova } from '../nova-calculator/calculate-nova.js';
import { resolveTariffVersion } from '../nova-calculator/tariff-table.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { NovaCalculationService } from './nova-calculation.service.js';

describe('NovaCalculationService', () => {
  const tenantId = 'tenant-1';
  let service: NovaCalculationService;
  const prisma = {
    vehicle: { findFirst: jest.fn() },
  };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
  };
  const siteContext = {
    tryGetSite: jest.fn().mockResolvedValue({ id: 'site-1' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NovaCalculationService,
        { provide: PrismaService, useValue: prisma },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: SiteContextService, useValue: siteContext },
      ],
    }).compile();
    service = module.get(NovaCalculationService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns the pure engine result for explicit inputs', async () => {
    const input = {
      co2GramsPerKm: 165,
      emissionCycle: 'WLTP' as const,
      netPriceEuro: 30_000,
      driveType: 'ICE' as const,
      taxableEventDate: '2025-03-01',
      vehicleClass: 'passenger_z3' as const,
    };
    const tariff = resolveTariffVersion(input.vehicleClass, input.taxableEventDate)!;

    await expect(service.calculate(input)).resolves.toEqual({
      ...calculateNova(input, tariff.id),
      hasUnverifiedRules: false,
    });
    expect(prisma.vehicle.findFirst).not.toHaveBeenCalled();
  });

  it('defaults taxable event dates using the Vienna calendar date', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2025-06-30T22:30:00.000Z'));

    const result = await service.calculate({
      co2GramsPerKm: 165,
      netPriceEuro: 30_000,
    });

    expect(result.tariffVersionId).toBe('at-m1-2025-h2');
  });

  it('fills vehicle inputs and lets explicit CO2 override the stored value', async () => {
    prisma.vehicle.findFirst.mockResolvedValue({
      first_registration_date: new Date('2024-03-02T00:00:00.000Z'),
      co2_wltp_g_km: 170,
      co2_nedc_g_km: 135,
      fuel_type: 'PETROL',
      power_kw: 100,
      nova_class: 'STANDARD',
    });

    const result = await service.calculate({
      vehicleId: 'vehicle-1',
      netPriceEuro: 20_000,
      co2GramsPerKm: 140,
      emissionCycle: 'WLTP',
      driveType: 'PHEV',
    });
    const input = {
      co2GramsPerKm: 140,
      emissionCycle: 'WLTP' as const,
      netPriceEuro: 20_000,
      driveType: 'PHEV' as const,
      taxableEventDate: new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Vienna',
      }).format(new Date()),
      firstRegistrationDate: '2024-03-02',
      vehicleClass: 'passenger_z3' as const,
      ratedPowerKw: 100,
    };
    const tariff = resolveTariffVersion(input.vehicleClass, input.taxableEventDate)!;

    expect(result).toEqual({
      ...calculateNova(input, tariff.id),
      hasUnverifiedRules: false,
    });
    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'vehicle-1',
        tenant_id: tenantId,
        OR: [
          { inventory_role: 'CUSTOMER' },
          {
            inventory_role: { in: ['USED', 'NEW', 'DEMO'] },
            location: { is: { site_id: 'site-1', type: 'vehicle_lot' } },
          },
        ],
      },
      select: expect.objectContaining({
        first_registration_date: true,
        co2_wltp_g_km: true,
        co2_nedc_g_km: true,
        fuel_type: true,
        power_kw: true,
        nova_class: true,
      }),
    });
  });

  it('returns a tenant scoped 404 when the vehicle cannot be found', async () => {
    prisma.vehicle.findFirst.mockResolvedValue(null);

    await expect(
      service.calculate({ vehicleId: 'foreign-vehicle', netPriceEuro: 10_000 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'foreign-vehicle',
          tenant_id: tenantId,
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it('limits dealer stock vehicle lookups to the active site', async () => {
    prisma.vehicle.findFirst.mockResolvedValue(null);

    await expect(
      service.calculate({ vehicleId: 'vehicle-elsewhere', netPriceEuro: 10_000 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'vehicle-elsewhere',
        tenant_id: tenantId,
        OR: [
          { inventory_role: 'CUSTOMER' },
          {
            inventory_role: { in: ['USED', 'NEW', 'DEMO'] },
            location: { is: { site_id: 'site-1', type: 'vehicle_lot' } },
          },
        ],
      },
      select: expect.any(Object),
    });
  });

  it('maps missing CO2 to a stable 422 code', async () => {
    await expect(
      service.calculate({
        netPriceEuro: 10_000,
        emissionCycle: 'WLTP',
        driveType: 'ICE',
        taxableEventDate: '2025-03-01',
      }),
    ).rejects.toMatchObject({
      constructor: UnprocessableEntityException,
      response: expect.objectContaining({ code: 'MISSING_CO2' }),
    });
  });

  it('maps malformed taxable event dates to INVALID_ISO_DATE before tariff lookup', async () => {
    await expect(
      service.calculate({
        co2GramsPerKm: 130,
        emissionCycle: 'WLTP',
        netPriceEuro: 20_000,
        driveType: 'ICE',
        taxableEventDate: 'not-a-date',
      }),
    ).rejects.toMatchObject({
      constructor: UnprocessableEntityException,
      response: expect.objectContaining({ code: 'INVALID_ISO_DATE' }),
    });
  });

  it('preserves engine warnings and marks unverified warnings', async () => {
    const result = await service.calculate({
      co2GramsPerKm: 130,
      emissionCycle: 'NEDC',
      netPriceEuro: 20_000,
      driveType: 'PHEV',
      taxableEventDate: '2025-03-01',
    });

    expect(result.warnings).toContain('nedc_fractional_co2_unverified');
    expect(result.warnings).toContain('phev_weighted_wltp');
    expect(result.hasUnverifiedRules).toBe(true);
  });
});

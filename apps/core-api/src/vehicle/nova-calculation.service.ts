import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LocationType, VehicleInventoryRole } from '@prisma/client';
import { NovaCalculationError } from '../nova-calculator/types.js';
import {
  calculateNova,
  validateNovaIsoDate,
} from '../nova-calculator/calculate-nova.js';
import { resolveTariffVersion } from '../nova-calculator/tariff-table.js';
import type {
  CalculateNovaInput,
  CalculateNovaResult,
  NovaDriveType,
  NovaVehicleClass,
} from '../nova-calculator/types.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteContextService } from '../site/site-context.service.js';

export type NovaCalculateInput = Partial<CalculateNovaInput> & {
  netPriceEuro: number;
  vehicleId?: string;
};

export type NovaCalculateResult = CalculateNovaResult & {
  hasUnverifiedRules: boolean;
};

type VehicleNovaInputs = {
  first_registration_date: Date | null;
  co2_wltp_g_km: number | null;
  co2_nedc_g_km: number | null;
  fuel_type: string | null;
  power_kw: number | null;
  nova_class: string | null;
};

const UNVERIFIED_WARNINGS = new Set([
  'nedc_fractional_co2_unverified',
  'fractional_co2_unverified',
]);

const VIENNA_DATE_FORMATTER = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Vienna',
});

function currentViennaIsoDate(): string {
  return VIENNA_DATE_FORMATTER.format(new Date());
}

function toIsoDate(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

function vehicleDriveType(vehicle: VehicleNovaInputs): NovaDriveType {
  const fuelType = vehicle.fuel_type?.toUpperCase();
  if (fuelType && ['ELECTRIC', 'BEV', 'BATTERY ELECTRIC'].includes(fuelType)) {
    return 'BEV';
  }
  if (fuelType && ['HYDROGEN', 'FCEV'].includes(fuelType)) return 'FCEV';
  if (
    fuelType &&
    ['PHEV', 'PLUG-IN HYBRID', 'PLUG_IN_HYBRID'].includes(fuelType)
  ) {
    return 'PHEV';
  }
  if (vehicle.nova_class === 'ELECTRIC_EXEMPT' && !fuelType) return 'BEV';
  return 'ICE';
}

function vehicleClass(value?: string | null): NovaVehicleClass {
  if (
    value === 'passenger_z3' ||
    value === 'n1_legacy_z6' ||
    value === 'motorcycle_z1_z2'
  ) {
    return value;
  }
  return 'passenger_z3';
}

function mapVehicleValues(
  vehicle: VehicleNovaInputs,
  explicit: NovaCalculateInput,
): CalculateNovaInput {
  const firstRegistrationDate = toIsoDate(
    vehicle.first_registration_date ?? undefined,
  );
  const co2FromVehicle =
    vehicle.co2_wltp_g_km ?? vehicle.co2_nedc_g_km ?? undefined;
  const referenceDate = explicit.taxableEventDate ?? currentViennaIsoDate();

  return {
    taxableEventDate: referenceDate,
    firstRegistrationDate:
      explicit.firstRegistrationDate ?? firstRegistrationDate,
    netPriceEuro: explicit.netPriceEuro,
    co2GramsPerKm: explicit.co2GramsPerKm ?? co2FromVehicle,
    emissionCycle:
      explicit.emissionCycle ??
      (vehicle.co2_wltp_g_km !== null
        ? 'WLTP'
        : vehicle.co2_nedc_g_km !== null
          ? 'NEDC'
          : 'WLTP'),
    driveType: explicit.driveType ?? vehicleDriveType(vehicle),
    vehicleClass: explicit.vehicleClass ?? vehicleClass(vehicle.nova_class),
    ratedPowerKw: explicit.ratedPowerKw ?? vehicle.power_kw ?? undefined,
    displacementCc: explicit.displacementCc,
    isCamperSA: explicit.isCamperSA,
  };
}

function mapExplicitValues(input: NovaCalculateInput): CalculateNovaInput {
  return {
    taxableEventDate: input.taxableEventDate ?? currentViennaIsoDate(),
    firstRegistrationDate: input.firstRegistrationDate,
    netPriceEuro: input.netPriceEuro,
    co2GramsPerKm: input.co2GramsPerKm,
    emissionCycle: input.emissionCycle ?? 'WLTP',
    driveType: input.driveType ?? 'OTHER',
    vehicleClass: input.vehicleClass ?? 'passenger_z3',
    ratedPowerKw: input.ratedPowerKw,
    displacementCc: input.displacementCc,
    isCamperSA: input.isCamperSA,
  };
}

@Injectable()
export class NovaCalculationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async calculate(input: NovaCalculateInput): Promise<NovaCalculateResult> {
    try {
      let engineInput: CalculateNovaInput;
      if (input.vehicleId) {
        const tenantId = await this.tenantContext.getTenantId();
        const activeSite = await this.siteContext.tryGetSite();
        const vehicle = await this.prisma.vehicle.findFirst({
          where: {
            id: input.vehicleId,
            tenant_id: tenantId,
            OR: [
              { inventory_role: VehicleInventoryRole.CUSTOMER },
              ...(activeSite
                ? [
                    {
                      inventory_role: {
                        in: [
                          VehicleInventoryRole.USED,
                          VehicleInventoryRole.NEW,
                          VehicleInventoryRole.DEMO,
                        ],
                      },
                      location: {
                        is: {
                          site_id: activeSite.id,
                          type: LocationType.vehicle_lot,
                        },
                      },
                    },
                  ]
                : []),
            ],
          },
          select: {
            first_registration_date: true,
            co2_wltp_g_km: true,
            co2_nedc_g_km: true,
            fuel_type: true,
            power_kw: true,
            nova_class: true,
          },
        });
        if (!vehicle) {
          throw new NotFoundException('Vehicle not found');
        }
        engineInput = mapVehicleValues(vehicle, input);
      } else {
        engineInput = mapExplicitValues(input);
      }

      validateNovaIsoDate(engineInput.taxableEventDate, 'taxableEventDate');
      const tariff = resolveTariffVersion(
        engineInput.vehicleClass ?? 'passenger_z3',
        engineInput.taxableEventDate,
      );
      if (!tariff) {
        throw new NovaCalculationError(
          'UNKNOWN_TARIFF_VERSION',
          `No tariff version for ${engineInput.vehicleClass} on ${engineInput.taxableEventDate}`,
        );
      }

      const result = calculateNova(engineInput, tariff.id);
      return {
        ...result,
        hasUnverifiedRules: result.warnings.some((warning) =>
          UNVERIFIED_WARNINGS.has(warning),
        ),
      };
    } catch (error) {
      if (error instanceof NovaCalculationError) {
        throw new UnprocessableEntityException({
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }
}

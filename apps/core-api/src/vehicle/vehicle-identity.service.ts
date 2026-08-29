import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeVehicleMakeAlias } from '../catalog/vehicle-make-alias.util';
import { VEHICLE_IDENTITY_PROVIDER } from './vehicle-identity.provider';
import type {
  VehicleIdentityProvider,
  VehicleIdentityProviderResult,
} from './vehicle-identity.provider';
import {
  VEHICLE_IDENTITY_RESET,
  createIdentityInputFingerprint,
  normalizeVehicleIdentityValue,
  stripVehicleIdentityResolutionState,
} from './vehicle-identity.util';

const MAX_IDENTITY_TRANSACTION_ATTEMPTS = 2;

@Injectable()
export class VehicleIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    @Inject(VEHICLE_IDENTITY_PROVIDER)
    private readonly provider: VehicleIdentityProvider,
  ) {}

  async resolveIdentity(vehicleId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      select: {
        id: true,
        vin: true,
        plate: true,
        identity_resolution_generation: true,
        identity_resolution_token: true,
      },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    const originalVin = vehicle.vin;
    const vin = normalizeVehicleIdentityValue(originalVin);
    if (!vin) {
      throw new BadRequestException(
        'Vehicle VIN is required for identity resolution',
      );
    }

    const originalPlate = vehicle.plate;
    const previousResolutionGeneration =
      vehicle.identity_resolution_generation ?? null;
    const previousResolutionToken = vehicle.identity_resolution_token ?? null;
    const resolutionToken = randomUUID();
    const plate = normalizeVehicleIdentityValue(originalPlate) || null;
    const reset = await this.prisma.vehicle.updateMany({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: originalVin,
        plate: originalPlate,
        identity_resolution_generation: previousResolutionGeneration,
        identity_resolution_token: previousResolutionToken,
      },
      data: {
        ...VEHICLE_IDENTITY_RESET,
        identity_resolution_generation: resolutionToken,
        identity_resolution_token: resolutionToken,
      },
    });

    if (reset.count !== 1) {
      throw new ConflictException(
        'Vehicle VIN or plate changed before identity resolution; please retry',
      );
    }

    let resolvedIdentity: VehicleIdentityProviderResult;
    try {
      resolvedIdentity = await this.provider.resolve({ vin, plate });
    } catch (error: unknown) {
      await this.prisma.vehicle.updateMany({
        where: {
          id: vehicleId,
          tenant_id: tenantId,
          vin: originalVin,
          plate: originalPlate,
          identity_resolution_generation: resolutionToken,
          identity_resolution_token: resolutionToken,
        },
        data: { identity_resolution_token: null },
      });
      const message =
        error instanceof Error
          ? error.message
          : 'Vehicle identity provider failed';
      throw new BadGatewayException(message);
    }

    await this.persistResolvedIdentity(
      tenantId,
      vehicleId,
      originalVin,
      vin,
      originalPlate,
      resolutionToken,
      resolvedIdentity,
    );

    const updatedVehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });

    if (!updatedVehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }

    const customer = updatedVehicle.customer_id
      ? await this.prisma.customer.findFirst({
          where: { id: updatedVehicle.customer_id, tenant_id: tenantId },
        })
      : null;

    return {
      ...stripVehicleIdentityResolutionState(updatedVehicle),
      customer,
    };
  }

  private async resolveMakeBrand(
    tenantId: string,
    decoderMake: string,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ) {
    const alias = await db.vehicleMakeAlias.findFirst({
      where: {
        tenant_id: tenantId,
        alias_normalized: normalizeVehicleMakeAlias(decoderMake),
        brand: { tenant_id: tenantId, isVehicleMake: true },
      },
      select: { brand: { select: { id: true, name: true } } },
    });

    if (alias?.brand) {
      return alias.brand;
    }

    const displayName = decoderMake.trim();
    const normalizedDisplayName = normalizeVehicleMakeAlias(displayName);
    const existingBrand = await db.brand.findFirst({
      where: {
        tenant_id: tenantId,
        normalized_name: normalizedDisplayName,
      },
      select: {
        id: true,
        name: true,
        normalized_name: true,
        isVehicleMake: true,
        isPartManufacturer: true,
      },
    });

    if (existingBrand) {
      if (!existingBrand.isVehicleMake) {
        const updated = await db.brand.updateMany({
          where: { id: existingBrand.id, tenant_id: tenantId },
          data: { isVehicleMake: true },
        });
        if (updated.count !== 1) {
          throw new ConflictException(
            'Vehicle make changed while resolving identity; please retry',
          );
        }
      }
      return { id: existingBrand.id, name: existingBrand.name };
    }

    return db.brand.upsert({
      where: {
        tenant_id_normalized_name: {
          tenant_id: tenantId,
          normalized_name: normalizedDisplayName,
        },
      },
      update: { isVehicleMake: true },
      create: {
        tenant_id: tenantId,
        name: displayName,
        normalized_name: normalizedDisplayName,
        isVehicleMake: true,
        isPartManufacturer: false,
      },
      select: { id: true, name: true },
    });
  }

  private async persistResolvedIdentity(
    tenantId: string,
    vehicleId: string,
    originalVin: string | null,
    vin: string,
    originalPlate: string | null,
    resolutionToken: string,
    resolvedIdentity: VehicleIdentityProviderResult,
    attempt = 1,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const makeBrand = await this.resolveMakeBrand(
          tenantId,
          resolvedIdentity.make,
          tx,
        );
        const identityResolvedAt = new Date();
        const updated = await tx.vehicle.updateMany({
          where: {
            id: vehicleId,
            tenant_id: tenantId,
            vin: originalVin,
            plate: originalPlate,
            identity_resolution_generation: resolutionToken,
            identity_resolution_token: resolutionToken,
          },
          data: {
            make: resolvedIdentity.make,
            model: resolvedIdentity.model,
            ...(resolvedIdentity.year !== undefined
              ? { year: resolvedIdentity.year }
              : {}),
            ...(resolvedIdentity.engine_code !== undefined
              ? { engine_code: resolvedIdentity.engine_code }
              : {}),
            ...(resolvedIdentity.fuel_type !== undefined
              ? { fuel_type: resolvedIdentity.fuel_type }
              : {}),
            ...(resolvedIdentity.power_kw !== undefined
              ? { power_kw: resolvedIdentity.power_kw }
              : {}),
            make_brand_id: makeBrand.id,
            hsn: resolvedIdentity.hsn ?? null,
            tsn: resolvedIdentity.tsn ?? null,
            identity_keys: resolvedIdentity.identity_keys ?? Prisma.JsonNull,
            identity_input_fingerprint: createIdentityInputFingerprint(
              vin,
              originalPlate,
            ),
            identity_resolved_at: identityResolvedAt,
            identity_resolution_token: null,
          },
        });

        if (updated.count !== 1) {
          throw new ConflictException(
            'Vehicle VIN or plate changed while resolving identity; please retry',
          );
        }
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        attempt < MAX_IDENTITY_TRANSACTION_ATTEMPTS
      ) {
        return this.persistResolvedIdentity(
          tenantId,
          vehicleId,
          originalVin,
          vin,
          originalPlate,
          resolutionToken,
          resolvedIdentity,
          attempt + 1,
        );
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Vehicle identity conflicted with another update; please retry',
        );
      }
      throw error;
    }
  }
}

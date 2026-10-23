import { withPhoneDigits } from '../customer/customer-phone.util.js';
import { withPlateNormalized } from '../vehicle/vehicle-plate.util.js';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  VehicleInventoryRole,
  VehicleRecordSource,
  VehicleStockStatus,
} from '@prisma/client';
import {
  partyWriteContext,
  setOwnerInTx,
} from '../vehicle/vehicle-party.writer.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RegisterIntakeDto } from './dto/register-intake.dto.js';
import {
  VEHICLE_IDENTITY_RESET,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
  stripVehicleIdentityResolutionState,
} from '../vehicle/vehicle-identity.util.js';

export interface UpdateExistingIntakeVehicleParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  existingVehicle: {
    id: string;
    plate: string | null;
    identity_resolution_generation: string | null;
    identity_resolution_token: string | null;
  };
  dto: RegisterIntakeDto;
  customerId: string;
  vin: string | null;
}

export interface CreateNewIntakeVehicleParams {
  tx: Prisma.TransactionClient;
  tenantId: string;
  dto: RegisterIntakeDto;
  customerId: string;
  vin: string | null;
}

export function validateStockPrepVehicle(vehicle: {
  inventory_role?: VehicleInventoryRole | null;
  stock_status?: VehicleStockStatus | null;
}): void {
  if (vehicle.inventory_role !== VehicleInventoryRole.USED) {
    throw new BadRequestException(
      'Stock prep requires a used dealer-stock vehicle',
    );
  }
  const isStockStatusValid =
    vehicle.stock_status === VehicleStockStatus.IN_STOCK ||
    vehicle.stock_status === VehicleStockStatus.RESERVED;
  if (!isStockStatusValid) {
    throw new BadRequestException(
      'Stock prep requires the vehicle to be in stock',
    );
  }
}

export async function updateExistingIntakeVehicle(
  params: UpdateExistingIntakeVehicleParams,
) {
  const { tx, tenantId, existingVehicle, dto, customerId, vin } = params;
  const identityChanged =
    normalizeVehicleIdentityValue(existingVehicle.plate) !==
    normalizeVehicleIdentityValue(dto.plate);
  const updated = await tx.vehicle.updateMany({
    where: {
      id: existingVehicle.id,
      tenant_id: tenantId,
      vin,
      plate: existingVehicle.plate,
      identity_resolution_generation:
        existingVehicle.identity_resolution_generation ?? null,
      identity_resolution_token:
        existingVehicle.identity_resolution_token ?? null,
    },
    data: withPlateNormalized({
      plate: dto.plate,
      ...(identityChanged
        ? { ...VEHICLE_IDENTITY_RESET, identity_resolution_token: null }
        : {}),
    }),
  });

  if (updated.count === 0) {
    throw new ConflictException(
      'Vehicle VIN or plate changed while registering intake; please retry',
    );
  }
  await setOwnerInTx(
    tx,
    partyWriteContext(tenantId),
    existingVehicle.id,
    customerId,
    VehicleRecordSource.MANUAL,
  );

  const vehicle = await tx.vehicle.findFirst({
    where: { id: existingVehicle.id, tenant_id: tenantId },
    include: { customer: true },
  });
  if (!vehicle) {
    throw new NotFoundException(`Vehicle ${existingVehicle.id} not found`);
  }
  return stripVehicleIdentityResolutionState(vehicle);
}

export async function createNewIntakeVehicle(
  params: CreateNewIntakeVehicleParams,
) {
  const { tx, tenantId, dto, customerId, vin } = params;
  let created: { id: string };
  try {
    created = await tx.vehicle.create({
      data: withPlateNormalized({
        tenant_id: tenantId,
        vin,
        plate: dto.plate,
        make: dto.make,
        model: dto.model,
        year: dto.year,
      }),
      select: { id: true },
    });
  } catch (error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'Vehicle was created by another intake; please retry',
      );
    }
    throw error;
  }
  await setOwnerInTx(
    tx,
    partyWriteContext(tenantId),
    created.id,
    customerId,
    VehicleRecordSource.MANUAL,
  );
  const vehicle = await tx.vehicle.findFirst({
    where: { id: created.id, tenant_id: tenantId },
    include: { customer: true },
  });
  if (!vehicle) {
    throw new NotFoundException(`Vehicle ${created.id} not found`);
  }
  return stripVehicleIdentityResolutionState(vehicle);
}

export async function resolveIntakeVehicle(
  tx: Prisma.TransactionClient,
  tenantId: string,
  dto: RegisterIntakeDto,
  customerId: string,
) {
  const vin = normalizeVehicleIdentityValueOrNull(dto.vin);
  const existingVehicle =
    vin === null
      ? null
      : await tx.vehicle.findFirst({
          where: { tenant_id: tenantId, vin },
          select: {
            id: true,
            plate: true,
            identity_resolution_generation: true,
            identity_resolution_token: true,
          },
        });

  if (existingVehicle) {
    return updateExistingIntakeVehicle({
      tx,
      tenantId,
      existingVehicle,
      dto,
      customerId,
      vin,
    });
  }

  return createNewIntakeVehicle({
    tx,
    tenantId,
    dto,
    customerId,
    vin,
  });
}

export async function computeCustomerId(
  prisma: PrismaService | Prisma.TransactionClient,
  tenantId: string,
  dto: RegisterIntakeDto,
): Promise<string> {
  if (dto.customerId) {
    const exists = await prisma.customer.findFirst({
      where: { id: dto.customerId, tenant_id: tenantId },
    });
    if (!exists) {
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    }
    return dto.customerId;
  }

  if (dto.email) {
    const existingCustomer = await prisma.customer.findFirst({
      where: { tenant_id: tenantId, email: dto.email },
    });
    if (existingCustomer) {
      return existingCustomer.id;
    }
  }

  const customer = await prisma.customer.create({
    data: withPhoneDigits({
      tenant_id: tenantId,
      first_name: dto.firstName || '',
      last_name: dto.lastName || '',
      email: dto.email,
      phone: dto.phone,
      type: 'PRIVATE',
    }),
  });
  return customer.id;
}

export async function executeRegisterIntake(
  prisma: PrismaService,
  tenantId: string,
  dto: RegisterIntakeDto,
) {
  const customerId = await computeCustomerId(prisma, tenantId, dto);

  return prisma.$transaction(async (tx) => {
    return resolveIntakeVehicle(tx, tenantId, dto, customerId);
  });
}

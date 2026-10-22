import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import type { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import {
  assertVehicleRegulatoryFields,
  normalizeVehicleRegulatoryFields,
} from './vehicle-regulatory.validation.js';
import { viennaIsoDay } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import { VehiclePersistenceService } from './vehicle-persistence.service.js';
import type { ExistingVehicleIdentity } from './vehicle-write.mapper.js';
import {
  buildVehicleCreatePayload,
  buildVehicleUpdatePayload,
} from './vehicle-write.mapper.js';

@Injectable()
export class VehicleWriteService {
  constructor(private readonly persistence: VehiclePersistenceService) {}

  async loadExistingIdentity(
    id: string,
    tenantId: string,
  ): Promise<ExistingVehicleIdentity> {
    const existingVehicle = await this.persistence.findIdentityForUpdate(
      id,
      tenantId,
    );

    if (!existingVehicle) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }

    return existingVehicle;
  }

  async prepareCreate(
    dto: CreateVehicleDto,
    tenantId: string,
  ): Promise<Prisma.VehicleUncheckedCreateInput> {
    if (dto.customer_id) {
      await this.assertCustomerExists(dto.customer_id, tenantId);
    }

    const normalizedDto = normalizeVehicleRegulatoryFields(dto);
    assertVehicleRegulatoryFields(normalizedDto);

    return buildVehicleCreatePayload(normalizedDto, tenantId);
  }

  async prepareUpdate(
    existingVehicle: ExistingVehicleIdentity,
    dto: UpdateVehicleDto,
    tenantId: string,
  ): Promise<Prisma.VehicleUncheckedUpdateManyInput> {
    if (dto.customer_id) {
      await this.assertCustomerExists(dto.customer_id, tenantId);
    }

    const normalizedDto = normalizeVehicleRegulatoryFields(dto);
    assertVehicleRegulatoryFields(normalizedDto);

    return buildVehicleUpdatePayload(existingVehicle, normalizedDto);
  }

  /**
   * Applies the guarded update and re-reads the row with its customer. A changed customer_id
   * also hands the OWNER party over in the same transaction. Throws
   * a conflict when VIN or plate changed under us, and not-found when the row
   * is gone.
   */
  async applyUpdate(
    id: string,
    tenantId: string,
    existingVehicle: ExistingVehicleIdentity,
    data: Prisma.VehicleUncheckedUpdateManyInput,
  ) {
    const updatedCount =
      data.customer_id === undefined
        ? await this.persistence.updateIfIdentityUnchanged(
            id,
            tenantId,
            existingVehicle,
            data,
          )
        : await this.persistence.updateIfIdentityUnchangedWithMainContact({
            id,
            tenantId,
            existingVehicle,
            data,
            customerId: data.customer_id as string | null,
            today: viennaIsoDay(new Date()),
          });

    if (updatedCount === 0) {
      await this.throwStaleOrMissing(id, tenantId);
    }

    const updatedVehicle = await this.persistence.findVehicleWithCustomer(
      id,
      tenantId,
    );

    if (!updatedVehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    return updatedVehicle;
  }

  private async assertCustomerExists(
    customerId: string,
    tenantId: string,
  ): Promise<void> {
    const exists = await this.persistence.customerExists(customerId, tenantId);

    if (!exists) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }
  }

  private async throwStaleOrMissing(
    id: string,
    tenantId: string,
  ): Promise<never> {
    const stillExists = await this.persistence.vehicleExists(id, tenantId);

    if (stillExists) {
      throw new ConflictException(
        'Vehicle VIN or plate changed while updating; please retry',
      );
    }

    throw new NotFoundException('Vehicle not found');
  }
}

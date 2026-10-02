import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertVehicleInspectionWriteAccess } from './vehicle-inspection.authorization.js';
import type { CreateVehicleInspectionRecordDto } from './dto/vehicle-inspection-record.dto.js';
import type { UpdateVehicleInspectionRecordDto } from './dto/vehicle-inspection-record.dto.js';

@Injectable()
export class VehicleInspectionRecordService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  async listForVehicle(vehicleId: string) {
    await this.assertVehicleExists(vehicleId);
    return this.prisma.vehicleInspectionRecord.findMany({
      where: { vehicle_id: vehicleId },
      orderBy: [{ inspected_on: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(vehicleId: string, recordId: string) {
    await this.assertVehicleExists(vehicleId);
    const record = await this.prisma.vehicleInspectionRecord.findFirst({
      where: { id: recordId, vehicle_id: vehicleId },
    });
    if (!record) {
      throw new NotFoundException('Vehicle inspection record not found');
    }
    return record;
  }

  async create(vehicleId: string, dto: CreateVehicleInspectionRecordDto) {
    assertVehicleInspectionWriteAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertVehicleExists(vehicleId);
    const user = this.tenantContext.getAuthenticatedUser();

    return this.prisma.vehicleInspectionRecord.create({
      data: {
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        inspection_type: dto.inspection_type,
        inspected_on: new Date(`${dto.inspected_on}T00:00:00.000Z`),
        plaketten_valid_until_year: dto.plaketten_valid_until_year,
        plaketten_valid_until_month: dto.plaketten_valid_until_month,
        station_name: dto.station_name,
        notes: dto.notes,
        source: 'MANUAL',
        created_by_user_id: user?.userId ?? null,
      },
    });
  }

  async update(
    vehicleId: string,
    recordId: string,
    dto: UpdateVehicleInspectionRecordDto,
  ) {
    assertVehicleInspectionWriteAccess(this.tenantContext);
    await this.findOne(vehicleId, recordId);

    const data: Prisma.VehicleInspectionRecordUpdateManyMutationInput = {};
    if (dto.inspected_on !== undefined) {
      data.inspected_on = new Date(`${dto.inspected_on}T00:00:00.000Z`);
    }
    if (dto.plaketten_valid_until_year !== undefined) {
      data.plaketten_valid_until_year = dto.plaketten_valid_until_year;
    }
    if (dto.plaketten_valid_until_month !== undefined) {
      data.plaketten_valid_until_month = dto.plaketten_valid_until_month;
    }
    if (dto.station_name !== undefined) {
      data.station_name = dto.station_name;
    }
    if (dto.notes !== undefined) {
      data.notes = dto.notes;
    }

    const tenantId = await this.tenantContext.getTenantId();
    const updated = await this.prisma.vehicleInspectionRecord.updateMany({
      where: { id: recordId, vehicle_id: vehicleId, tenant_id: tenantId },
      data,
    });
    if (updated.count === 0) {
      throw new NotFoundException('Vehicle inspection record not found');
    }
    return this.findOne(vehicleId, recordId);
  }

  async remove(vehicleId: string, recordId: string) {
    assertVehicleInspectionWriteAccess(this.tenantContext);
    await this.findOne(vehicleId, recordId);
    const tenantId = await this.tenantContext.getTenantId();
    const deleted = await this.prisma.vehicleInspectionRecord.deleteMany({
      where: { id: recordId, vehicle_id: vehicleId, tenant_id: tenantId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Vehicle inspection record not found');
    }
  }

  private async assertVehicleExists(vehicleId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${vehicleId} not found`);
    }
  }
}

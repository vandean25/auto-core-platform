import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VehicleEquipmentOption } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import {
  type ReplaceVehicleEquipmentDto,
  type VehicleEquipmentAssignmentDto,
  type VehicleEquipmentFreeTextItemDto,
  type VehicleEquipmentOptionDto,
  type VehicleEquipmentOptionListResponseDto,
} from './dto/vehicle-equipment.dto.js';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto.js';
import { resolveVehicleEquipmentForProfile } from './vehicle-equipment-portal-map.resolver.js';
import type {
  EquipmentListingSerializerProfile,
  ResolvedVehicleEquipmentExport,
} from './vehicle-equipment-portal-map.types.js';

function toOptionDto(row: VehicleEquipmentOption): VehicleEquipmentOptionDto {
  return {
    id: row.id,
    code: row.code,
    label_de: row.label_de,
    label_en: row.label_en,
    category: row.category,
    active: row.active,
  };
}

@Injectable()
export class VehicleEquipmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async listOptions(
    page = 1,
    limit = 100,
    search?: string,
  ): Promise<VehicleEquipmentOptionListResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(200, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;
    const trimmedSearch = search?.trim();

    const where = {
      tenant_id: tenantId,
      active: true,
      ...(trimmedSearch
        ? {
            OR: [
              { code: { contains: trimmedSearch, mode: 'insensitive' as const } },
              { label_de: { contains: trimmedSearch, mode: 'insensitive' as const } },
              { label_en: { contains: trimmedSearch, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.vehicleEquipmentOption.findMany({
        where,
        orderBy: [{ category: 'asc' }, { code: 'asc' }],
        skip,
        take: safeLimit,
      }),
      this.prisma.vehicleEquipmentOption.count({ where }),
    ]);

    const pageCount = Math.max(1, Math.ceil(total / safeLimit));
    return {
      data: rows.map(toOptionDto),
      meta: {
        total,
        page: safePage,
        pageSize: safeLimit,
        pageCount: total === 0 ? 0 : pageCount,
      } satisfies PaginationMetaDto,
    };
  }

  async getVehicleEquipment(
    vehicleId: string,
  ): Promise<VehicleEquipmentAssignmentDto> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId);

    const [selections, freeTextItems] = await Promise.all([
      this.prisma.vehicleEquipmentSelection.findMany({
        where: { tenant_id: tenantId, vehicle_id: vehicleId },
        include: { option: true },
        orderBy: { option: { code: 'asc' } },
      }),
      this.prisma.vehicleEquipmentFreeTextItem.findMany({
        where: { tenant_id: tenantId, vehicle_id: vehicleId },
        orderBy: { sort_order: 'asc' },
      }),
    ]);

    return {
      options: selections.map((row) => toOptionDto(row.option)),
      free_text_items: freeTextItems.map(
        (row): VehicleEquipmentFreeTextItemDto => ({
          id: row.id,
          text: row.text,
          sort_order: row.sort_order,
        }),
      ),
    };
  }

  async replaceVehicleEquipment(
    vehicleId: string,
    dto: ReplaceVehicleEquipmentDto,
  ): Promise<VehicleEquipmentAssignmentDto> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId);

    const optionIds = dto.option_ids ?? [];
    const freeTextLines = (dto.free_text_lines ?? [])
      .map((line) => line.trim())
      .filter(Boolean);

    const options =
      optionIds.length === 0
        ? []
        : await this.prisma.vehicleEquipmentOption.findMany({
            where: {
              tenant_id: tenantId,
              id: { in: optionIds },
              active: true,
            },
          });

    if (options.length !== optionIds.length) {
      throw new BadRequestException({
        code: 'VEHICLE_EQUIPMENT_OPTION_INVALID',
        message: 'One or more equipment options are unknown or inactive.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.vehicleEquipmentSelection.deleteMany({
        where: { tenant_id: tenantId, vehicle_id: vehicleId },
      });
      await tx.vehicleEquipmentFreeTextItem.deleteMany({
        where: { tenant_id: tenantId, vehicle_id: vehicleId },
      });

      if (options.length > 0) {
        await tx.vehicleEquipmentSelection.createMany({
          data: options.map((option) => ({
            tenant_id: tenantId,
            vehicle_id: vehicleId,
            option_id: option.id,
          })),
        });
      }

      if (freeTextLines.length > 0) {
        await tx.vehicleEquipmentFreeTextItem.createMany({
          data: freeTextLines.map((text, index) => ({
            tenant_id: tenantId,
            vehicle_id: vehicleId,
            text,
            sort_order: index,
          })),
        });
      }
    });

    return this.getVehicleEquipment(vehicleId);
  }

  async resolveExportForVehicle(
    vehicleId: string,
    profile: EquipmentListingSerializerProfile,
    extraPassThroughFreeText: string[] = [],
  ): Promise<ResolvedVehicleEquipmentExport> {
    const assignment = await this.getVehicleEquipment(vehicleId);
    return resolveVehicleEquipmentForProfile(profile, {
      selections: assignment.options.map((option) => ({
        code: option.code,
        label_de: option.label_de,
        label_en: option.label_en,
      })),
      freeTextLines: assignment.free_text_items.map((item) => item.text),
      passThroughFreeText: extraPassThroughFreeText,
    });
  }

  private async assertStockVehicleAtActiveSite(
    tenantId: string,
    vehicleId: string,
  ) {
    const siteId = await this.siteContext.getSiteId();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        location: { site_id: siteId },
      },
      select: { id: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    return vehicle;
  }
}

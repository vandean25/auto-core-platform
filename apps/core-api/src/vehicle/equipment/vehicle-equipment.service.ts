import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  VehicleEquipmentAssertion,
  type VehicleEquipmentOption,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import { assertTenantAdmin } from '../../site/site.authorization.js';
import {
  type PatchVehicleEquipmentOptionDto,
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
import { resolveCurrentReceivedStockPurchaseId } from './vehicle-equipment-stock-cycle.js';

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
              {
                code: { contains: trimmedSearch, mode: 'insensitive' as const },
              },
              {
                label_de: {
                  contains: trimmedSearch,
                  mode: 'insensitive' as const,
                },
              },
              {
                label_en: {
                  contains: trimmedSearch,
                  mode: 'insensitive' as const,
                },
              },
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

  async patchOption(
    optionId: string,
    dto: PatchVehicleEquipmentOptionDto,
  ): Promise<VehicleEquipmentOptionDto> {
    const tenantId = await this.tenantContext.getTenantId();
    assertTenantAdmin(this.tenantContext);

    const updated = await this.prisma.vehicleEquipmentOption.update({
      where: { tenant_id: tenantId, id: optionId },
      data: { active: dto.active },
    });
    return toOptionDto(updated);
  }

  async getVehicleEquipment(
    vehicleId: string,
  ): Promise<VehicleEquipmentAssignmentDto> {
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId);
    const stockPurchaseId = await resolveCurrentReceivedStockPurchaseId(
      this.prisma,
      tenantId,
      vehicleId,
    );

    const [selections, freeTextItems] = await Promise.all([
      this.prisma.vehicleEquipmentSelection.findMany({
        where: { tenant_id: tenantId, stock_purchase_id: stockPurchaseId },
        include: { option: true },
        orderBy: { option: { code: 'asc' } },
      }),
      this.prisma.vehicleEquipmentFreeTextItem.findMany({
        where: { tenant_id: tenantId, stock_purchase_id: stockPurchaseId },
        orderBy: { sort_order: 'asc' },
      }),
    ]);

    return {
      stock_purchase_id: stockPurchaseId,
      selections: selections.map((row) => ({
        option: toOptionDto(row.option),
        assertion: row.assertion,
      })),
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
    const stockPurchaseId = await resolveCurrentReceivedStockPurchaseId(
      this.prisma,
      tenantId,
      vehicleId,
    );

    const selectionRows = dto.selections ?? [];
    const optionIds = selectionRows.map((row) => row.option_id);
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
      const locked = await tx.vehicle.updateMany({
        where: { tenant_id: tenantId, id: vehicleId },
        data: { updatedAt: new Date() },
      });
      if (locked.count !== 1) {
        throw new NotFoundException(`Vehicle ${vehicleId} not found`);
      }

      await tx.vehicleEquipmentSelection.deleteMany({
        where: { tenant_id: tenantId, stock_purchase_id: stockPurchaseId },
      });
      await tx.vehicleEquipmentFreeTextItem.deleteMany({
        where: { tenant_id: tenantId, stock_purchase_id: stockPurchaseId },
      });

      if (selectionRows.length > 0) {
        await tx.vehicleEquipmentSelection.createMany({
          data: selectionRows.map((row) => ({
            tenant_id: tenantId,
            vehicle_id: vehicleId,
            stock_purchase_id: stockPurchaseId,
            option_id: row.option_id,
            assertion: row.assertion,
          })),
        });
      }

      if (freeTextLines.length > 0) {
        await tx.vehicleEquipmentFreeTextItem.createMany({
          data: freeTextLines.map((text, index) => ({
            tenant_id: tenantId,
            vehicle_id: vehicleId,
            stock_purchase_id: stockPurchaseId,
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
    const presentSelections = assignment.selections.filter(
      (row) => row.assertion === VehicleEquipmentAssertion.PRESENT,
    );
    return resolveVehicleEquipmentForProfile(profile, {
      selections: presentSelections.map((row) => ({
        code: row.option.code,
        label_de: row.option.label_de,
        label_en: row.option.label_en,
        assertion: 'PRESENT',
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

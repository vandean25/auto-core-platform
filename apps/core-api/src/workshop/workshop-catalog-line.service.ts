import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { normalizeVehicleMakeAlias } from '../catalog/vehicle-make-alias.util';
import { verifyCatalogHitPayload } from '../catalog/catalog-hit-payload';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AddWorkshopTaskLineFromCatalogDto } from './dto/add-workshop-task-line-from-catalog.dto';

const MAX_CATALOG_LINE_TRANSACTION_ATTEMPTS = 2;

type CatalogLineRecord = {
  id: string;
  type: WorkshopLineItemType;
  item_no: string;
  description: string;
  quantity: Prisma.Decimal;
  unit_price: Prisma.Decimal;
  part_execution_status: WorkshopPartLineExecutionStatus | null;
  catalog_item_id: string | null;
  source_system: string | null;
  external_operation_code: string | null;
  fitment_notes: string | null;
  cost_price_est: Prisma.Decimal | null;
  oem_numbers: Prisma.JsonValue | null;
  labor_category_id: string | null;
  hourly_rate_snapshot: Prisma.Decimal | null;
  catalog_hit_jti: string | null;
  labor_operation_id: string | null;
  standard_aw: Prisma.Decimal | null;
  actual_hours: Prisma.Decimal | null;
  internal_cost_rate: Prisma.Decimal | null;
};

type CatalogItemRecord = {
  id: string;
  sku: string;
};

type WorkshopTaskForCatalogLine = {
  id: string;
  tenant_id: string;
  workshop_order_id: string;
  line_items_version: number;
  workshop_order: {
    status: WorkshopOrderStatus;
    purpose: WorkshopOrderPurpose;
    vehicle_id: string;
  };
};

@Injectable()
export class WorkshopCatalogLineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async addLineFromCatalog(
    orderId: string,
    taskId: string,
    dto: AddWorkshopTaskLineFromCatalogDto,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const claims = this.verifyToken(dto.hitToken);

    this.assertUrlBinding({ claims, tenantId, orderId, taskId });

    const add = async (
      attempt: number,
    ): Promise<{
      line: ReturnType<WorkshopCatalogLineService['mapLine']>;
      lineItemsVersion: number;
    }> => {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const task = await tx.workshopTask.findFirst({
              where: { id: taskId, tenant_id: tenantId },
              select: {
                id: true,
                tenant_id: true,
                workshop_order_id: true,
                line_items_version: true,
                workshop_order: {
                  select: {
                    status: true,
                    purpose: true,
                    vehicle_id: true,
                  },
                },
              },
            });

            if (!task) {
              throw new NotFoundException(
                `Workshop task ${taskId} was not found`,
              );
            }

            this.assertCurrentBinding(task, claims, orderId);
            this.assertOrderEditable(task.workshop_order);

            const existingLine = await tx.workshopTaskLineItem.findFirst({
              where: {
                tenant_id: tenantId,
                workshop_task_id: taskId,
                catalog_hit_jti: claims.jti,
              },
            });

            if (existingLine) {
              return {
                line: this.mapLine(existingLine),
                lineItemsVersion: task.line_items_version,
              };
            }

            const lineData =
              claims.concern === 'PARTS'
                ? await this.buildPartLine({ tx, tenantId, taskId, claims })
                : await this.buildLaborLine({
                    tx,
                    tenantId,
                    taskId,
                    claims,
                    requestedCategoryId: dto.laborCategoryId,
                  });
            const line = await tx.workshopTaskLineItem.create({
              data: lineData,
            });
            const versionUpdate = await tx.workshopTask.updateMany({
              where: { id: taskId, tenant_id: tenantId },
              data: { line_items_version: { increment: 1 } },
            });

            if (versionUpdate.count !== 1) {
              throw new ConflictException(
                'Workshop task changed while adding line',
              );
            }

            return {
              line: this.mapLine(line),
              lineItemsVersion: task.line_items_version + 1,
            };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!this.isRetryableTransactionError(error)) {
          throw error;
        }
        if (attempt >= MAX_CATALOG_LINE_TRANSACTION_ATTEMPTS) {
          throw new ConflictException(
            'Catalog line conflicted with another request; please retry',
          );
        }
        return add(attempt + 1);
      }
    };

    return add(1);
  }

  private verifyToken(token: string) {
    try {
      return verifyCatalogHitPayload(token);
    } catch {
      throw new UnauthorizedException('Invalid catalog hit token');
    }
  }

  private assertUrlBinding(params: {
    claims: ReturnType<typeof verifyCatalogHitPayload>;
    tenantId: string;
    orderId: string;
    taskId: string;
  }): void {
    if (
      params.claims.tenantId !== params.tenantId ||
      params.claims.workshopOrderId !== params.orderId ||
      params.claims.taskId !== params.taskId
    ) {
      throw new ConflictException(
        'Catalog hit token binding conflicts with URL',
      );
    }
  }

  private assertCurrentBinding(
    task: WorkshopTaskForCatalogLine,
    claims: ReturnType<typeof verifyCatalogHitPayload>,
    orderId: string,
  ): void {
    if (
      task.workshop_order_id !== orderId ||
      task.workshop_order.vehicle_id !== claims.vehicleId
    ) {
      throw new ConflictException(
        'Catalog hit token binding conflicts with current workshop context',
      );
    }
  }

  private assertOrderEditable(order: {
    status: WorkshopOrderStatus;
    purpose: WorkshopOrderPurpose;
  }): void {
    if (
      order.status === WorkshopOrderStatus.INVOICED ||
      (order.purpose === WorkshopOrderPurpose.STOCK_PREP &&
        order.status === WorkshopOrderStatus.COMPLETED)
    ) {
      throw new ConflictException('Workshop order cannot be edited');
    }
  }

  private async buildPartLine(params: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    taskId: string;
    claims: ReturnType<typeof verifyCatalogHitPayload>;
  }): Promise<Prisma.WorkshopTaskLineItemUncheckedCreateInput> {
    const { tx, tenantId, taskId, claims } = params;
    const unitPrice = claims.unitPrice;
    const articleNumber = claims.articleNumber?.trim();
    if (unitPrice === undefined || unitPrice === null || !articleNumber) {
      throw new UnauthorizedException('Incomplete catalog hit token');
    }

    const brandId = await this.findOrCreateBrand(
      tx,
      tenantId,
      claims.brandLabel,
    );
    const catalogItem = await this.upsertCatalogItem({
      tx,
      tenantId,
      claims,
      brandId,
      unitPrice,
    });

    return {
      tenant_id: tenantId,
      workshop_task_id: taskId,
      type: WorkshopLineItemType.PART,
      part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
      item_no: catalogItem.sku,
      description: claims.name,
      quantity: new Prisma.Decimal(1),
      unit_price: new Prisma.Decimal(unitPrice),
      catalog_item_id: catalogItem.id,
      source_system: claims.sourceSystem,
      external_operation_code: null,
      fitment_notes: claims.fitmentNotes ?? null,
      cost_price_est: claims.costPriceEst ?? null,
      oem_numbers: claims.oemNumbers ?? Prisma.JsonNull,
      labor_category_id: null,
      hourly_rate_snapshot: null,
      catalog_hit_jti: claims.jti,
      labor_operation_id: null,
      standard_aw: null,
      actual_hours: null,
      internal_cost_rate: null,
    };
  }

  private async buildLaborLine(params: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    taskId: string;
    claims: ReturnType<typeof verifyCatalogHitPayload>;
    requestedCategoryId?: string;
  }): Promise<Prisma.WorkshopTaskLineItemUncheckedCreateInput> {
    const { tx, tenantId, taskId, claims, requestedCategoryId } = params;
    const settings = await tx.catalogProviderSettings.findFirst({
      where: { tenant_id: tenantId },
      select: {
        default_labor_category_id: true,
        aw_minutes: true,
      },
    });
    const laborCategoryId =
      requestedCategoryId ?? settings?.default_labor_category_id;

    if (!laborCategoryId) {
      throw new UnprocessableEntityException(
        'A labor category is required to add a labor line',
      );
    }

    const category = await tx.laborCategory.findFirst({
      where: { id: laborCategoryId, tenant_id: tenantId, is_active: true },
      select: {
        id: true,
        default_hourly_rate: true,
        default_internal_cost_rate: true,
      },
    });

    if (!category || category.default_hourly_rate === null) {
      throw new UnprocessableEntityException(
        'Labor category must have a selling rate',
      );
    }

    const operationCode = claims.externalOperationCode?.trim();
    if (!operationCode) {
      throw new UnauthorizedException('Incomplete catalog hit token');
    }

    const plannedHours =
      claims.plannedHours !== null && claims.plannedHours !== undefined
        ? new Prisma.Decimal(claims.plannedHours)
        : new Prisma.Decimal(claims.standardAw ?? 0).mul(
            new Prisma.Decimal(settings?.aw_minutes ?? 6).div(60),
          );
    const hourlyRate = category.default_hourly_rate;

    return {
      tenant_id: tenantId,
      workshop_task_id: taskId,
      type: WorkshopLineItemType.LABOR,
      part_execution_status: null,
      item_no: operationCode,
      description: claims.name,
      quantity: plannedHours,
      unit_price: hourlyRate,
      catalog_item_id: null,
      source_system: claims.sourceSystem,
      external_operation_code: operationCode,
      fitment_notes: null,
      cost_price_est: null,
      oem_numbers: Prisma.JsonNull,
      labor_category_id: category.id,
      hourly_rate_snapshot: hourlyRate,
      catalog_hit_jti: claims.jti,
      labor_operation_id: null,
      standard_aw: claims.standardAw ?? null,
      actual_hours: null,
      internal_cost_rate: category.default_internal_cost_rate ?? null,
    };
  }

  private async findOrCreateBrand(
    tx: Prisma.TransactionClient,
    tenantId: string,
    brandLabel: string | null | undefined,
  ): Promise<number> {
    const name = brandLabel?.trim() || 'UNKNOWN';
    const normalizedName = normalizeVehicleMakeAlias(name) || 'UNKNOWN';
    const existing = await tx.brand.findFirst({
      where: { tenant_id: tenantId, normalized_name: normalizedName },
      select: { id: true },
    });
    if (existing) {
      return existing.id;
    }

    const created = await tx.brand.create({
      data: {
        tenant_id: tenantId,
        name,
        normalized_name: normalizedName,
        isPartManufacturer: true,
      },
      select: { id: true },
    });
    return created.id;
  }

  private async upsertCatalogItem(params: {
    tx: Prisma.TransactionClient;
    tenantId: string;
    claims: ReturnType<typeof verifyCatalogHitPayload>;
    brandId: number;
    unitPrice: number;
  }): Promise<CatalogItemRecord> {
    const { tx, tenantId, claims, brandId, unitPrice } = params;
    const identityWhere = {
      tenant_id: tenantId,
      source_system: claims.sourceSystem,
      external_article_id: claims.externalId,
    };
    const mutableData = {
      name: claims.name,
      cost_price: claims.costPriceEst ?? null,
      retail_price: new Prisma.Decimal(unitPrice),
      unit: claims.unit?.trim() || 'pcs',
      ean: claims.ean ?? null,
      oem_numbers: claims.oemNumbers ?? Prisma.JsonNull,
      brand_id: brandId,
    };
    const existing = await tx.catalogItem.findFirst({
      where: identityWhere,
      select: { id: true, sku: true },
    });

    if (existing) {
      const updated = await tx.catalogItem.updateMany({
        where: { id: existing.id, tenant_id: tenantId },
        data: mutableData,
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          'Catalog item changed while adding workshop line',
        );
      }
      return existing;
    }

    const sku = await this.buildSku(tx, tenantId, claims);
    const createData = {
      tenant_id: tenantId,
      sku,
      ...mutableData,
      source_system: claims.sourceSystem,
      external_article_id: claims.externalId,
    } satisfies Prisma.CatalogItemUncheckedCreateInput;

    return tx.catalogItem.create({
      data: createData,
      select: { id: true, sku: true },
    });
  }

  private async buildSku(
    tx: Prisma.TransactionClient,
    tenantId: string,
    claims: ReturnType<typeof verifyCatalogHitPayload>,
  ): Promise<string> {
    const candidates = ([8, 12] as const).map((hashLength) =>
      this.buildSkuWithHash(tenantId, claims, hashLength),
    );
    const existingItems = await tx.catalogItem.findMany({
      where: { tenant_id: tenantId, sku: { in: candidates } },
      select: { sku: true },
    });
    const occupiedSkus = new Set(existingItems.map((item) => item.sku));
    const availableSku = candidates.find(
      (candidate) => !occupiedSkus.has(candidate),
    );

    if (!availableSku) {
      throw new ConflictException(
        'Unable to allocate a unique catalog item SKU; please retry',
      );
    }

    return availableSku;
  }

  private buildSkuWithHash(
    tenantId: string,
    claims: ReturnType<typeof verifyCatalogHitPayload>,
    hashLength: 8 | 12,
  ): string {
    const hash = createHash('sha256')
      .update(`${tenantId}|${claims.sourceSystem}|${claims.externalId}`)
      .digest('hex')
      .slice(0, hashLength);
    return [
      normalizeSourceSegment(claims.sourceSystem),
      normalizeCompactSegment(claims.brandLabel ?? '') || 'UNKNOWN',
      normalizeCompactSegment(claims.articleNumber ?? '') || 'UNKNOWN',
      hash,
    ].join('-');
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private isRetryableTransactionError(error: unknown): boolean {
    return (
      this.isUniqueViolation(error) ||
      (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034')
    );
  }

  private mapLine(line: CatalogLineRecord) {
    return {
      id: line.id,
      type: line.type,
      itemNo: line.item_no,
      description: line.description,
      qty: Number(line.quantity),
      unitPrice: Number(line.unit_price),
      partExecutionStatus: line.part_execution_status,
      catalogItemId: line.catalog_item_id,
      sourceSystem: line.source_system,
      externalOperationCode: line.external_operation_code,
      fitmentNotes: line.fitment_notes,
      costPriceEst:
        line.cost_price_est === null ? null : Number(line.cost_price_est),
      oemNumbers: toStringArray(line.oem_numbers),
      laborCategoryId: line.labor_category_id,
      hourlyRateSnapshot:
        line.hourly_rate_snapshot === null
          ? null
          : Number(line.hourly_rate_snapshot),
      catalogHitJti: line.catalog_hit_jti,
      laborOperationId: line.labor_operation_id,
      standardAw: line.standard_aw === null ? null : Number(line.standard_aw),
      actualHours:
        line.actual_hours === null ? null : Number(line.actual_hours),
      internalCostRate:
        line.internal_cost_rate === null
          ? null
          : Number(line.internal_cost_rate),
    };
  }
}

function normalizeSourceSegment(value: string): string {
  return (
    value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'UNKNOWN'
  );
}

function normalizeCompactSegment(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 24);
}

function toStringArray(value: Prisma.JsonValue | null): string[] | null {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string')
  ) {
    return null;
  }
  return value;
}

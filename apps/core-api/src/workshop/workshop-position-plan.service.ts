import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type CatalogItem,
  type LaborOperation,
  LocationType,
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { AtpService } from '../inventory/atp.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { executeCreateOnHandReservation } from '../parts-requisition/parts-requisition-lifecycle.helpers.js';
import {
  DEFERRED_PART_RESERVATION_MARKER,
  PLAN_STALE,
  POSITION_PLAN_VERSION,
  type ResolvedPositionPlan,
  type ResolvedPositionPlanLine,
} from './workshop-position-plan.types.js';
import {
  formatQuantityString,
  hoursToDurationMinutes,
  laborNetCents,
  partNetCents,
} from './workshop-position-plan.math.js';

type RawPlanLine = Record<string, unknown>;

export type CallerPositionLine = {
  preset_key?: string;
  labor_operation_id?: string;
  catalog_item_id?: string;
  quantity_milli?: number;
  quantity_aw_milli?: number;
  reserve_part?: boolean;
};

@Injectable()
export class WorkshopPositionPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly atpService: AtpService,
  ) {}

  hasPlanContent(input: Record<string, unknown>): boolean {
    const plan = input.position_plan;
    if (plan && typeof plan === 'object' && !Array.isArray(plan)) {
      const lines = (plan as Record<string, unknown>).lines;
      if (Array.isArray(lines) && lines.length > 0) {
        return true;
      }
    }
    const callerLines = input.position_lines;
    return Array.isArray(callerLines) && callerLines.length > 0;
  }

  async resolvePlan(
    tenantId: string,
    siteId: string,
    input: Record<string, unknown>,
  ): Promise<ResolvedPositionPlan | null> {
    const rawLines = this.collectRawLines(input);
    if (rawLines.length === 0) {
      return null;
    }
    const lines = await this.buildResolvedLines(tenantId, siteId, rawLines);
    const fingerprint = this.fingerprint(lines);
    return { version: POSITION_PLAN_VERSION, lines, fingerprint };
  }

  assertStoredPlanMatches(
    stored: ResolvedPositionPlan | null,
    recomputed: ResolvedPositionPlan | null,
  ): void {
    if (!stored && !recomputed) {
      return;
    }
    if (!stored && recomputed) {
      return;
    }
    if (stored && !recomputed) {
      throw new ConflictException({
        code: PLAN_STALE,
        message: 'The position plan changed; submit a new review',
      });
    }
    if (!stored || !recomputed) {
      return;
    }
    if (stored.fingerprint !== recomputed.fingerprint) {
      throw new ConflictException({
        code: PLAN_STALE,
        message: 'The position plan changed; submit a new review',
      });
    }
    for (let i = 0; i < stored.lines.length; i++) {
      const a = stored.lines[i];
      const b = recomputed.lines[i];
      if (
        a.netCents !== b.netCents ||
        a.unitPriceCents !== b.unitPriceCents ||
        a.quantity !== b.quantity ||
        a.reservation !== b.reservation
      ) {
        throw new ConflictException({
          code: PLAN_STALE,
          message: 'The position plan changed; submit a new review',
        });
      }
    }
  }

  parseStoredPlan(input: Record<string, unknown>): ResolvedPositionPlan | null {
    const plan = input.position_plan;
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
      return null;
    }
    const record = plan as Record<string, unknown>;
    const lines = record.lines;
    if (!Array.isArray(lines) || lines.length === 0) {
      return null;
    }
    const resolved: ResolvedPositionPlanLine[] = lines.map((line) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        throw new BadRequestException('Invalid position plan line');
      }
      const row = line as Record<string, unknown>;
      const kind = row.kind === 'PART' ? 'PART' : 'LABOR';
      const reservation = this.readReservation(row.reservation);
      return {
        presetKey:
          typeof row.preset_key === 'string' ? row.preset_key : undefined,
        kind,
        laborOperationId:
          typeof row.labor_operation_id === 'string'
            ? row.labor_operation_id
            : null,
        catalogItemId:
          typeof row.catalog_item_id === 'string' ? row.catalog_item_id : null,
        description:
          typeof row.description === 'string' ? row.description : 'Position',
        quantity: typeof row.quantity === 'string' ? row.quantity : '1.000',
        unit:
          typeof row.unit === 'string'
            ? row.unit
            : kind === 'LABOR'
              ? 'h'
              : 'pcs',
        unitPriceCents: Number(row.unit_price_cents ?? 0),
        netCents: Number(row.net_cents ?? 0),
        reservation,
      };
    });
    return {
      version: Number(record.version ?? POSITION_PLAN_VERSION),
      lines: resolved,
      fingerprint: this.fingerprint(resolved),
    };
  }

  async applyPlanInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
    orderId: string,
    orderStatus: WorkshopOrderStatus,
    plan: ResolvedPositionPlan,
  ): Promise<void> {
    const existingTaskCount = await tx.workshopTask.count({
      where: { tenant_id: tenantId, workshop_order_id: orderId },
    });
    if (existingTaskCount > 0) {
      return;
    }

    let sequence = 0;
    for (const line of plan.lines) {
      sequence += 1;
      const task = await tx.workshopTask.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          title: line.description,
          status: WorkshopTaskStatus.NOT_STARTED,
          sequence,
        },
      });

      const isLabor = line.kind === 'LABOR';
      const lineItem = await tx.workshopTaskLineItem.create({
        data: {
          tenant_id: tenantId,
          workshop_task_id: task.id,
          type: isLabor
            ? WorkshopLineItemType.LABOR
            : WorkshopLineItemType.PART,
          part_execution_status: isLabor
            ? null
            : WorkshopPartLineExecutionStatus.PENDING_PICK,
          item_no: isLabor ? 'LABOR' : 'PART',
          description: line.description,
          quantity: new Prisma.Decimal(line.quantity),
          unit_price: new Prisma.Decimal(line.unitPriceCents / 100),
          labor_operation_id: line.laborOperationId,
          catalog_item_id: line.catalogItemId,
          standard_aw: isLabor ? new Prisma.Decimal(line.quantity) : null,
          hourly_rate_snapshot: isLabor
            ? new Prisma.Decimal(line.unitPriceCents / 100)
            : null,
          external_operation_code:
            !isLabor && line.reservation === 'unbooked'
              ? DEFERRED_PART_RESERVATION_MARKER
              : null,
        },
      });

      if (
        !isLabor &&
        line.catalogItemId &&
        line.reservation === 'reserved' &&
        orderStatus === WorkshopOrderStatus.SCHEDULED
      ) {
        await this.reservePartLineInTransaction(
          tx,
          tenantId,
          siteId,
          lineItem.id,
          line.catalogItemId,
          new Prisma.Decimal(line.quantity),
        );
      }
    }
  }

  async fulfillDeferredReservationsOnIntake(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
    orderId: string,
  ): Promise<void> {
    const lines = await tx.workshopTaskLineItem.findMany({
      where: {
        tenant_id: tenantId,
        external_operation_code: DEFERRED_PART_RESERVATION_MARKER,
        workshop_task: { workshop_order_id: orderId },
      },
      select: {
        id: true,
        catalog_item_id: true,
        quantity: true,
        parts_reservations: { select: { id: true }, take: 1 },
      },
    });
    for (const line of lines) {
      if (line.parts_reservations.length > 0 || !line.catalog_item_id) {
        continue;
      }
      await this.reservePartLineInTransaction(
        tx,
        tenantId,
        siteId,
        line.id,
        line.catalog_item_id,
        line.quantity,
      );
      await tx.workshopTaskLineItem.updateMany({
        where: { id: line.id, tenant_id: tenantId },
        data: { external_operation_code: null },
      });
    }
  }

  toPayloadPositionPlan(plan: ResolvedPositionPlan): Record<string, unknown> {
    return {
      version: plan.version,
      lines: plan.lines.map((line) => ({
        ...(line.presetKey ? { preset_key: line.presetKey } : {}),
        kind: line.kind,
        labor_operation_id: line.laborOperationId,
        catalog_item_id: line.catalogItemId,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price_cents: line.unitPriceCents,
        net_cents: line.netCents,
        reservation: line.reservation,
      })),
    };
  }

  private collectRawLines(input: Record<string, unknown>): RawPlanLine[] {
    const plan = input.position_plan;
    if (plan && typeof plan === 'object' && !Array.isArray(plan)) {
      const lines = (plan as Record<string, unknown>).lines;
      if (Array.isArray(lines)) {
        return lines.filter(
          (line) => line && typeof line === 'object' && !Array.isArray(line),
        ) as RawPlanLine[];
      }
    }
    const callerLines = input.position_lines;
    if (!Array.isArray(callerLines)) {
      return [];
    }
    return callerLines
      .filter(
        (line) => line && typeof line === 'object' && !Array.isArray(line),
      )
      .map((line) => this.callerLineToRaw(line as CallerPositionLine));
  }

  private callerLineToRaw(line: CallerPositionLine): RawPlanLine {
    const raw: RawPlanLine = {};
    if (line.preset_key) {
      raw.preset_key = line.preset_key;
    }
    if (line.labor_operation_id) {
      raw.labor_operation_id = line.labor_operation_id;
    }
    if (line.catalog_item_id) {
      raw.catalog_item_id = line.catalog_item_id;
    }
    if (line.quantity_milli !== undefined) {
      raw.quantity_milli = line.quantity_milli;
    }
    if (line.quantity_aw_milli !== undefined) {
      raw.quantity_aw_milli = line.quantity_aw_milli;
    }
    if (line.reserve_part === true) {
      raw.reservation = 'reserved';
    } else if (line.catalog_item_id) {
      raw.reservation = 'unbooked';
    }
    return raw;
  }

  private readReservation(
    value: unknown,
  ): ResolvedPositionPlanLine['reservation'] {
    if (value === 'reserved' || value === 'unbooked') {
      return value;
    }
    return 'not_applicable';
  }

  private async buildResolvedLines(
    tenantId: string,
    siteId: string,
    rawLines: RawPlanLine[],
  ): Promise<ResolvedPositionPlanLine[]> {
    const presetKeys = rawLines
      .map((line) =>
        typeof line.preset_key === 'string' ? line.preset_key : null,
      )
      .filter((key): key is string => Boolean(key));

    const presets =
      presetKeys.length > 0
        ? await this.prisma.workshopCommandPreset.findMany({
            where: {
              tenant_id: tenantId,
              preset_key: { in: presetKeys },
              active: true,
              OR: [{ site_id: siteId }, { site_id: null }],
            },
          })
        : [];

    const presetByKey = new Map<string, (typeof presets)[number]>();
    for (const preset of presets) {
      const existing = presetByKey.get(preset.preset_key);
      if (!existing || preset.site_id === siteId) {
        presetByKey.set(preset.preset_key, preset);
      }
    }

    const laborIds = new Set<string>();
    const catalogIds = new Set<string>();
    for (const line of rawLines) {
      const presetKey =
        typeof line.preset_key === 'string' ? line.preset_key : undefined;
      const preset = presetKey ? presetByKey.get(presetKey) : undefined;
      const laborId =
        (typeof line.labor_operation_id === 'string'
          ? line.labor_operation_id
          : undefined) ??
        preset?.labor_operation_id ??
        undefined;
      const catalogId =
        (typeof line.catalog_item_id === 'string'
          ? line.catalog_item_id
          : undefined) ??
        preset?.catalog_item_id ??
        undefined;
      if (presetKey && !preset) {
        throw new UnprocessableEntityException({
          code: 'UNSUPPORTED_SERVICE',
          message: `Preset ${presetKey} is not configured at this site`,
        });
      }
      if (laborId) {
        laborIds.add(laborId);
      }
      if (catalogId) {
        catalogIds.add(catalogId);
      }
    }

    const emptyLabor: LaborOperation[] = [];
    const emptyCatalog: CatalogItem[] = [];
    const [laborOps, catalogItems] = await Promise.all([
      laborIds.size > 0
        ? this.prisma.laborOperation.findMany({
            where: {
              tenant_id: tenantId,
              id: { in: [...laborIds] },
              is_active: true,
            },
          })
        : emptyLabor,
      catalogIds.size > 0
        ? this.prisma.catalogItem.findMany({
            where: { tenant_id: tenantId, id: { in: [...catalogIds] } },
          })
        : emptyCatalog,
    ]);

    const laborById = new Map(laborOps.map((row) => [row.id, row]));
    const catalogById = new Map(catalogItems.map((row) => [row.id, row]));

    const resolved: ResolvedPositionPlanLine[] = [];
    for (const line of rawLines) {
      resolved.push(
        this.resolveLine(line, presetByKey, laborById, catalogById, siteId),
      );
    }
    return resolved;
  }

  private resolveLine(
    line: RawPlanLine,
    presetByKey: Map<
      string,
      {
        preset_key: string;
        kind: string;
        labor_operation_id: string | null;
        catalog_item_id: string | null;
        duration_minutes: number | null;
        quantity_milli: number | null;
      }
    >,
    laborById: Map<
      string,
      {
        id: string;
        description: string;
        standard_aw: Prisma.Decimal;
        hourly_rate: Prisma.Decimal;
      }
    >,
    catalogById: Map<
      string,
      {
        id: string;
        sku: string;
        name: string;
        unit: string;
        retail_price: Prisma.Decimal;
      }
    >,
    siteId: string,
  ): ResolvedPositionPlanLine {
    const presetKey =
      typeof line.preset_key === 'string' ? line.preset_key : undefined;
    const preset = presetKey ? presetByKey.get(presetKey) : undefined;
    const kind =
      preset?.kind === 'PART' || line.catalog_item_id ? 'PART' : 'LABOR';

    if (kind === 'LABOR') {
      const laborId =
        (typeof line.labor_operation_id === 'string'
          ? line.labor_operation_id
          : undefined) ??
        preset?.labor_operation_id ??
        null;
      if (!laborId) {
        throw new BadRequestException(
          'Labor position requires labor_operation_id',
        );
      }
      const labor = laborById.get(laborId);
      if (!labor) {
        throw new UnprocessableEntityException(
          `Labor operation ${laborId} is not available`,
        );
      }
      let durationMinutes: number;
      if (typeof line.quantity_aw_milli === 'number') {
        durationMinutes = hoursToDurationMinutes(line.quantity_aw_milli / 1000);
      } else if (preset?.duration_minutes != null) {
        durationMinutes = preset.duration_minutes;
      } else {
        durationMinutes = hoursToDurationMinutes(Number(labor.standard_aw));
      }
      const hours = durationMinutes / 60;
      const unitPriceCents = new Prisma.Decimal(labor.hourly_rate)
        .mul(100)
        .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
        .toNumber();
      const netCents = laborNetCents(durationMinutes, unitPriceCents);
      return {
        presetKey,
        kind: 'LABOR',
        laborOperationId: laborId,
        catalogItemId: null,
        description: labor.description,
        quantity: formatQuantityString(hours),
        unit: 'h',
        unitPriceCents,
        netCents,
        reservation: 'not_applicable',
        durationMinutes,
      };
    }

    const catalogId =
      (typeof line.catalog_item_id === 'string'
        ? line.catalog_item_id
        : undefined) ??
      preset?.catalog_item_id ??
      null;
    if (!catalogId) {
      throw new BadRequestException('Part position requires catalog_item_id');
    }
    const catalog = catalogById.get(catalogId);
    if (!catalog) {
      throw new UnprocessableEntityException(
        `Catalog item ${catalogId} is not available`,
      );
    }
    void siteId;
    const quantityMilli =
      typeof line.quantity_milli === 'number'
        ? line.quantity_milli
        : (preset?.quantity_milli ?? 1000);
    const unitPriceCents = new Prisma.Decimal(catalog.retail_price)
      .mul(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();
    const netCents = partNetCents(quantityMilli, unitPriceCents);
    const reservation = this.readReservation(
      line.reservation ??
        (line.reserve_part === true ? 'reserved' : 'unbooked'),
    );
    return {
      presetKey,
      kind: 'PART',
      laborOperationId: null,
      catalogItemId: catalogId,
      description: catalog.name,
      quantity: formatQuantityString(quantityMilli / 1000),
      unit: catalog.unit,
      unitPriceCents,
      netCents,
      reservation: reservation === 'not_applicable' ? 'unbooked' : reservation,
      quantityMilli,
    };
  }

  private fingerprint(lines: ResolvedPositionPlanLine[]): string {
    const canonical = lines.map((line) => ({
      kind: line.kind,
      labor_operation_id: line.laborOperationId,
      catalog_item_id: line.catalogItemId,
      quantity: line.quantity,
      unit_price_cents: line.unitPriceCents,
      net_cents: line.netCents,
      reservation: line.reservation,
    }));
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private async reservePartLineInTransaction(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
    lineItemId: string,
    catalogItemId: string,
    quantity: Prisma.Decimal,
  ): Promise<void> {
    const location = await this.findReservationLocation(
      tx,
      tenantId,
      siteId,
      catalogItemId,
      quantity,
    );
    if (!location) {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: 'Insufficient stock to reserve the planned part line',
      });
    }
    await executeCreateOnHandReservation(
      tx,
      tenantId,
      siteId,
      {
        workshopTaskLineItemId: lineItemId,
        quantity: quantity.toNumber(),
        locationId: location.id,
      },
      this.atpService,
    );
  }

  private async findReservationLocation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    siteId: string,
    catalogItemId: string,
    quantity: Prisma.Decimal,
  ): Promise<{ id: string } | null> {
    const stocks = await tx.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        catalog_item_id: catalogItemId,
        location: {
          type: LocationType.bin,
          deletedAt: null,
          site_id: siteId,
          tenant_id: tenantId,
        },
      },
      select: {
        location_id: true,
        quantity_on_hand: true,
        quantity_reserved: true,
      },
    });
    for (const stock of stocks) {
      const available = new Prisma.Decimal(stock.quantity_on_hand).sub(
        stock.quantity_reserved,
      );
      if (available.gte(quantity)) {
        return { id: stock.location_id };
      }
    }
    return null;
  }
}

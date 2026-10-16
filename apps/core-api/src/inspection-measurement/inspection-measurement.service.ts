import { Inject, Injectable } from '@nestjs/common';
import {
  InspectionMeasurementImportState,
  Prisma,
  type InspectionMeasurement,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import {
  assertMeasurementReadAccess,
  assertMeasurementWriteAccess,
} from './inspection-measurement.authorization.js';
import {
  assertForcesWithinDeviceRange,
  assertMeasuredAtNotFuture,
  measuredAtInstant,
  parseCanonicalBrakeMeasurementUtf8,
} from './inspection-measurement-canonical.js';
import {
  deviceBindingMismatch,
  deviceSourceNotFound,
  measurementConflict,
  measurementImportNotFound,
  measurementNotConfigured,
  reviewRequired,
  unsupportedSchemaVersion,
  vehicleIdentityMismatch,
  workshopOrderNotFound,
} from './inspection-measurement.errors.js';
import {
  InspectionMeasurementApplyConflictSignal,
  InspectionMeasurementIdentityRaceSignal,
} from './inspection-measurement-apply.signals.js';
import {
  previewFingerprint,
  semanticDigestForMeasurement,
  sha256Utf8,
} from './inspection-measurement-fingerprint.js';
import {
  BRAKE_MEASUREMENT_READ_PORT,
  type BrakeMeasurementReadPort,
} from './inspection-measurement.port.js';
import type { CanonicalBrakeMeasurement } from './inspection-measurement.types.js';
import type { PreviewMeasurementImportDto } from './dto/preview-measurement-import.dto.js';
import type { ApplyMeasurementImportDto } from './dto/apply-measurement-import.dto.js';

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

type ResolvedPreview = {
  measurement: CanonicalBrakeMeasurement;
  semanticDigest: string;
  fingerprint: string;
  originalDigest: string;
  state: InspectionMeasurementImportState;
  quarantineReason: string | null;
  errorCode: string | null;
};

@Injectable()
export class InspectionMeasurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    @Inject(BRAKE_MEASUREMENT_READ_PORT)
    private readonly brakePort: BrakeMeasurementReadPort,
  ) {}

  async previewImport(
    orderId: string,
    dto: PreviewMeasurementImportDto,
    now = new Date(),
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const order = await this.loadOrder(tenantId, siteId, orderId);
    await assertMeasurementWriteAccess(
      this.prisma,
      this.tenantContext,
      tenantId,
      order,
    );

    const deviceSource = await this.prisma.inspectionDeviceSource.findFirst({
      where: {
        id: dto.device_source_id,
        tenant_id: tenantId,
        site_id: siteId,
        is_active: true,
        read_enabled: true,
      },
    });
    if (!deviceSource) {
      throw deviceSourceNotFound();
    }
    if (deviceSource.profile_id === 'TEST_ONLY' && isProductionRuntime()) {
      throw measurementNotConfigured();
    }

    const envelope = await this.brakePort.readMeasurement(
      {
        profileId: deviceSource.profile_id,
        profileDigest: deviceSource.profile_digest,
        sourceInstanceId: deviceSource.source_instance_id,
        deviceSerial: deviceSource.device_serial,
        bindingRevision: deviceSource.binding_revision,
        rangeMin: deviceSource.range_min.toFixed(3),
        rangeMax: deviceSource.range_max.toFixed(3),
        rangeUnit: deviceSource.range_unit,
      },
      dto.native_measurement_reference,
    );

    if (envelope.status === 'NOT_CONFIGURED') {
      throw measurementNotConfigured();
    }
    if (envelope.status !== 'RESULT' || !envelope.canonical) {
      throw measurementNotConfigured();
    }

    const resolved = await this.resolvePreview(
      tenantId,
      envelope.canonical,
      envelope.originalUtf8,
      order,
      deviceSource,
      now,
    );

    const existingIdentity =
      await this.prisma.inspectionMeasurementIdentity.findFirst({
        where: {
          tenant_id: tenantId,
          source_system: 'WORKSHOP_NET',
          source_instance_id: envelope.canonical.source_instance_id,
          measurement_id: envelope.canonical.measurement_id,
        },
      });
    if (
      existingIdentity &&
      existingIdentity.semantic_digest !== resolved.semanticDigest
    ) {
      await this.appendSupportEvent({
        tenantId,
        siteId,
        objectId: existingIdentity.id,
        reason: 'MEASUREMENT_CONFLICT',
        actorUserId: user.id,
        sourceDigest: resolved.semanticDigest,
        detail: { conflicting_digest: existingIdentity.semantic_digest },
      });
      throw measurementConflict();
    }
    if (
      existingIdentity &&
      (existingIdentity.workshop_order_id !== order.id ||
        existingIdentity.vehicle_id !== order.vehicle_id)
    ) {
      throw measurementConflict();
    }

    const importRow = await this.prisma.inspectionMeasurementImport.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        workshop_order_id: order.id,
        vehicle_id: order.vehicle_id,
        device_source_id: deviceSource.id,
        state: resolved.state,
        native_measurement_reference: dto.native_measurement_reference,
        preview_fingerprint:
          resolved.state === 'READY_FOR_REVIEW' ? resolved.fingerprint : null,
        semantic_digest: resolved.semanticDigest,
        preview_expires_at:
          resolved.state === 'READY_FOR_REVIEW'
            ? new Date(now.getTime() + PREVIEW_TTL_MS)
            : null,
        quarantine_reason: resolved.quarantineReason,
        error_code: resolved.errorCode,
        created_by_user_id: user.id,
      },
    });

    await this.appendSupportEvent({
      tenantId,
      siteId,
      objectId: importRow.id,
      reason: resolved.quarantineReason ?? resolved.state,
      actorUserId: user.id,
      sourceDigest: resolved.semanticDigest,
    });

    return this.mapPreview(importRow, resolved);
  }

  async applyImport(
    orderId: string,
    importId: string,
    dto: ApplyMeasurementImportDto,
    now = new Date(),
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const order = await this.loadOrder(tenantId, siteId, orderId);
    await assertMeasurementWriteAccess(
      this.prisma,
      this.tenantContext,
      tenantId,
      order,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const importRow = await tx.inspectionMeasurementImport.findFirst({
          where: {
            id: importId,
            tenant_id: tenantId,
            site_id: siteId,
            workshop_order_id: orderId,
          },
          include: { deviceSource: true },
        });
        if (!importRow) {
          throw measurementImportNotFound(importId);
        }

        if (importRow.state === 'APPLIED' && importRow.applied_measurement_id) {
          const existing = await tx.inspectionMeasurement.findFirst({
            where: {
              id: importRow.applied_measurement_id,
              tenant_id: tenantId,
            },
          });
          if (!existing) {
            throw measurementImportNotFound(importId);
          }
          return this.mapApplyResponse(existing, true);
        }

        if (importRow.state !== 'READY_FOR_REVIEW') {
          throw reviewRequired();
        }
        if (importRow.version !== dto.version) {
          throw reviewRequired();
        }
        if (
          !importRow.preview_fingerprint ||
          importRow.preview_fingerprint !== dto.fingerprint
        ) {
          throw reviewRequired();
        }
        if (
          importRow.preview_expires_at &&
          importRow.preview_expires_at.getTime() < now.getTime()
        ) {
          throw reviewRequired();
        }

        const envelope = await this.brakePort.readMeasurement(
          {
            profileId: importRow.deviceSource.profile_id,
            profileDigest: importRow.deviceSource.profile_digest,
            sourceInstanceId: importRow.deviceSource.source_instance_id,
            deviceSerial: importRow.deviceSource.device_serial,
            bindingRevision: importRow.deviceSource.binding_revision,
            rangeMin: importRow.deviceSource.range_min.toFixed(3),
            rangeMax: importRow.deviceSource.range_max.toFixed(3),
            rangeUnit: importRow.deviceSource.range_unit,
          },
          importRow.native_measurement_reference,
        );
        if (envelope.status !== 'RESULT' || !envelope.canonical) {
          throw reviewRequired();
        }

        const resolved = await this.resolvePreview(
          tenantId,
          envelope.canonical,
          envelope.originalUtf8,
          order,
          importRow.deviceSource,
          now,
        );
        if (resolved.state !== 'READY_FOR_REVIEW') {
          throw reviewRequired();
        }
        if (resolved.fingerprint !== dto.fingerprint) {
          throw reviewRequired();
        }

        const identityKey = {
          tenant_id: tenantId,
          source_system: 'WORKSHOP_NET' as const,
          source_instance_id: envelope.canonical.source_instance_id,
          measurement_id: envelope.canonical.measurement_id,
        };

        const existingIdentity =
          await tx.inspectionMeasurementIdentity.findFirst({
            where: identityKey,
          });
        if (existingIdentity) {
          if (existingIdentity.semantic_digest === resolved.semanticDigest) {
            const existingMeasurement =
              await tx.inspectionMeasurement.findFirst({
                where: {
                  tenant_id: tenantId,
                  measurement_identity_id: existingIdentity.id,
                },
              });
            if (!existingMeasurement) {
              throw reviewRequired();
            }
            await tx.inspectionMeasurementImport.updateMany({
              where: {
                id: importId,
                tenant_id: tenantId,
                version: dto.version,
              },
              data: {
                state: 'APPLIED',
                applied_measurement_id: existingMeasurement.id,
                measurement_identity_id: existingIdentity.id,
                reviewed_by_user_id: user.id,
                reviewed_at: now,
                version: { increment: 1 },
              },
            });
            return this.mapApplyResponse(existingMeasurement, true);
          }
          throw new InspectionMeasurementApplyConflictSignal({
            tenantId,
            siteId,
            importId,
            actorUserId: user.id,
            previousState: importRow.state,
            semanticDigest: resolved.semanticDigest,
            conflictingDigest: existingIdentity.semantic_digest,
            reason: 'MEASUREMENT_CONFLICT',
          });
        }

        const identity = await tx.inspectionMeasurementIdentity.create({
          data: {
            ...identityKey,
            vehicle_id: order.vehicle_id,
            workshop_order_id: order.id,
            device_source_id: importRow.device_source_id,
            session_ref: envelope.canonical.session_ref,
            semantic_digest: resolved.semanticDigest,
          },
        });

        let measurement: InspectionMeasurement;
        try {
          measurement = await tx.inspectionMeasurement.create({
            data: {
              tenant_id: tenantId,
              site_id: siteId,
              workshop_order_id: order.id,
              vehicle_id: order.vehicle_id,
              device_source_id: importRow.device_source_id,
              import_id: importRow.id,
              measurement_identity_id: identity.id,
              source_system: 'WORKSHOP_NET',
              source_instance_id: envelope.canonical.source_instance_id,
              measurement_id: envelope.canonical.measurement_id,
              revision: envelope.canonical.revision,
              session_ref: envelope.canonical.session_ref,
              vehicle_vin: envelope.canonical.vehicle_vin,
              measured_at: measuredAtInstant(envelope.canonical.measured_at),
              finality: envelope.canonical.finality,
              test_kind: envelope.canonical.test_kind,
              wheels_json: envelope.canonical.wheels,
              device_evidence_ref: envelope.canonical.device_evidence_ref,
              native_result_ref: envelope.canonical.native_result_ref,
              previous_measurement_ref:
                envelope.canonical.previous_measurement_ref,
              original_digest: resolved.originalDigest,
              semantic_digest: resolved.semanticDigest,
              applied_by_user_id: user.id,
            },
          });
        } catch (error: unknown) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new InspectionMeasurementIdentityRaceSignal({
              tenantId,
              siteId,
              importId,
              actorUserId: user.id,
              orderId: order.id,
              vehicleId: order.vehicle_id,
              deviceSourceId: importRow.device_source_id,
              identityKey,
              semanticDigest: resolved.semanticDigest,
              importVersion: dto.version,
            });
          }
          throw error;
        }

        await tx.inspectionMeasurementImport.updateMany({
          where: { id: importId, tenant_id: tenantId, version: dto.version },
          data: {
            state: 'APPLIED',
            applied_measurement_id: measurement.id,
            measurement_identity_id: identity.id,
            reviewed_by_user_id: user.id,
            reviewed_at: now,
            version: { increment: 1 },
          },
        });

        await this.appendSupportEvent(
          {
            tenantId,
            siteId,
            objectId: importRow.id,
            reason: 'APPLIED',
            actorUserId: user.id,
            sourceDigest: resolved.semanticDigest,
          },
          tx,
        );

        return this.mapApplyResponse(measurement, false);
      });
    } catch (error: unknown) {
      if (error instanceof InspectionMeasurementIdentityRaceSignal) {
        return await this.reconcileApplyIdentityRace(error.params, now);
      }
      if (error instanceof InspectionMeasurementApplyConflictSignal) {
        await this.persistApplyConflict(error.params);
        if (error.params.reason === 'MEASUREMENT_CONFLICT') {
          throw measurementConflict();
        }
        throw reviewRequired();
      }
      throw error;
    }
  }

  async listActiveDeviceSources() {
    assertMeasurementReadAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const rows = await this.prisma.inspectionDeviceSource.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        is_active: true,
        read_enabled: true,
      },
      orderBy: { source_instance_id: 'asc' },
      select: {
        id: true,
        source_instance_id: true,
        device_serial: true,
        device_model: true,
        profile_id: true,
        binding_revision: true,
      },
    });
    return { data: rows };
  }

  async listImports(orderId: string, page = 1, limit = 20) {
    assertMeasurementReadAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const cappedLimit = Math.min(Math.max(limit, 1), 50);
    const skip = (Math.max(page, 1) - 1) * cappedLimit;

    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      select: { id: true },
    });
    if (!order) {
      throw workshopOrderNotFound();
    }

    const [rows, total] = await Promise.all([
      this.prisma.inspectionMeasurementImport.findMany({
        where: { tenant_id: tenantId, workshop_order_id: orderId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: cappedLimit,
      }),
      this.prisma.inspectionMeasurementImport.count({
        where: { tenant_id: tenantId, workshop_order_id: orderId },
      }),
    ]);

    const appliedIds = rows
      .map((row) => row.applied_measurement_id)
      .filter((id): id is string => Boolean(id));
    const appliedRows =
      appliedIds.length > 0
        ? await this.prisma.inspectionMeasurement.findMany({
            where: { tenant_id: tenantId, id: { in: appliedIds } },
            include: {
              deviceSource: { select: { device_serial: true } },
            },
          })
        : [];
    const appliedById = new Map(appliedRows.map((row) => [row.id, row]));

    return {
      data: rows.map((row) =>
        this.mapListItem(
          row,
          appliedById.get(row.applied_measurement_id ?? ''),
        ),
      ),
      meta: {
        total,
        page: Math.max(page, 1),
        pageSize: cappedLimit,
        pageCount: Math.ceil(total / cappedLimit) || 1,
      },
    };
  }

  private async loadOrder(tenantId: string, siteId: string, orderId: string) {
    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: orderId, tenant_id: tenantId, site_id: siteId },
      include: {
        vehicle: { select: { id: true, vin: true } },
        tasks: { select: { mechanic_id: true } },
      },
    });
    if (!order) {
      throw workshopOrderNotFound();
    }
    return order;
  }

  private async resolvePreview(
    tenantId: string,
    measurement: CanonicalBrakeMeasurement,
    originalUtf8: string,
    order: {
      id: string;
      order_number: string;
      vehicle_id: string;
      vehicle: { vin: string | null };
    },
    deviceSource: {
      id: string;
      profile_digest: string;
      profile_id: string;
      profile_version: string;
      device_serial: string;
      source_instance_id: string;
      binding_revision: number;
      range_min: Prisma.Decimal;
      range_max: Prisma.Decimal;
    },
    now: Date,
  ): Promise<ResolvedPreview> {
    parseCanonicalBrakeMeasurementUtf8(originalUtf8);

    if (measurement.native_schema_version !== deviceSource.profile_version) {
      throw unsupportedSchemaVersion();
    }

    if (
      deviceSource.profile_id !== 'TEST_ONLY' &&
      measurement.native_schema_version.startsWith('TEST_ONLY')
    ) {
      throw measurementNotConfigured();
    }

    if (
      measurement.profile_digest &&
      measurement.profile_digest !== deviceSource.profile_digest
    ) {
      throw deviceBindingMismatch();
    }
    if (measurement.device_serial !== deviceSource.device_serial) {
      throw deviceBindingMismatch();
    }
    if (measurement.source_instance_id !== deviceSource.source_instance_id) {
      throw deviceBindingMismatch();
    }

    const orderVin = (order.vehicle.vin ?? '').trim().toUpperCase();
    if (measurement.vehicle_vin !== orderVin) {
      throw vehicleIdentityMismatch();
    }
    if (measurement.workshop_order_ref !== order.order_number) {
      throw vehicleIdentityMismatch();
    }

    assertForcesWithinDeviceRange(
      measurement,
      deviceSource.range_min.toFixed(3),
      deviceSource.range_max.toFixed(3),
    );

    assertMeasuredAtNotFuture(
      measurement.measured_at,
      now,
      FUTURE_TOLERANCE_MS,
    );
    const measuredAt = measuredAtInstant(measurement.measured_at);

    const semanticDigest = semanticDigestForMeasurement(measurement);
    const fingerprint = previewFingerprint(
      semanticDigest,
      deviceSource.binding_revision,
      order.id,
      measurement.vehicle_vin,
      measurement.session_ref,
    );
    const originalDigest = sha256Utf8(originalUtf8);

    const evidence = await this.prisma.inspectionDeviceEvidence.findFirst({
      where: {
        tenant_id: tenantId,
        device_source_id: deviceSource.id,
        evidence_ref: measurement.device_evidence_ref,
        applicability_reviewed: true,
        effective_from: { lte: measuredAt },
        OR: [
          { effective_until_exclusive: null },
          { effective_until_exclusive: { gt: measuredAt } },
        ],
      },
    });

    let state: InspectionMeasurementImportState = 'READY_FOR_REVIEW';
    let quarantineReason: string | null = null;
    let errorCode: string | null = null;

    if (now.getTime() - measuredAt.getTime() > STALE_MS) {
      state = 'QUARANTINED';
      quarantineReason = 'STALE_MEASUREMENT';
    } else if (!evidence) {
      state = 'QUARANTINED';
      quarantineReason = 'UNCONFIRMED_DEVICE';
    } else if (measurement.finality !== 'FINAL') {
      state = 'QUARANTINED';
      quarantineReason = 'PARTIAL_FINALITY';
      errorCode = 'RESULT_UNCONFIRMED';
    }

    return {
      measurement,
      semanticDigest,
      fingerprint,
      originalDigest,
      state,
      quarantineReason,
      errorCode,
    };
  }

  private mapPreview(
    importRow: {
      id: string;
      state: string;
      version: number;
      preview_expires_at: Date | null;
      preview_fingerprint: string | null;
      error_code: string | null;
      quarantine_reason: string | null;
    },
    resolved: ResolvedPreview,
  ) {
    return {
      id: importRow.id,
      state: importRow.state,
      version: importRow.version,
      preview_expires_at: importRow.preview_expires_at?.toISOString() ?? null,
      fingerprint: importRow.preview_fingerprint,
      error_code: importRow.error_code,
      reviewed_fields: {
        measured_at: resolved.measurement.measured_at,
        finality: resolved.measurement.finality,
        test_kind: resolved.measurement.test_kind,
        device_serial: resolved.measurement.device_serial,
        session_ref: resolved.measurement.session_ref,
        quarantine_reason: importRow.quarantine_reason,
        wheels: resolved.measurement.wheels,
      },
    };
  }

  private mapApplyResponse(
    measurement: InspectionMeasurement,
    replay: boolean,
  ) {
    const wheels = measurement.wheels_json as Array<{
      axle: number;
      side: string;
      force: string;
      unit: string;
    }>;
    return {
      measurement: {
        id: measurement.id,
        measurement_id: measurement.measurement_id,
        revision: measurement.revision,
        measured_at: measurement.measured_at.toISOString(),
        semantic_digest: measurement.semantic_digest,
        wheels,
      },
      replay,
    };
  }

  private mapListItem(
    row: {
      id: string;
      state: string;
      native_measurement_reference: string;
      preview_fingerprint: string | null;
      semantic_digest: string | null;
      quarantine_reason: string | null;
      error_code: string | null;
      version: number;
      createdAt: Date;
    },
    appliedMeasurement?: InspectionMeasurement & {
      deviceSource?: { device_serial: string };
    },
  ) {
    return {
      id: row.id,
      state: row.state,
      native_measurement_reference: row.native_measurement_reference,
      preview_fingerprint: row.preview_fingerprint,
      semantic_digest: row.semantic_digest,
      quarantine_reason: row.quarantine_reason,
      error_code: row.error_code,
      version: row.version,
      createdAt: row.createdAt,
      applied_measurement: appliedMeasurement
        ? {
            id: appliedMeasurement.id,
            measurement_id: appliedMeasurement.measurement_id,
            revision: appliedMeasurement.revision,
            measured_at: appliedMeasurement.measured_at.toISOString(),
            semantic_digest: appliedMeasurement.semantic_digest,
            device_serial:
              appliedMeasurement.deviceSource?.device_serial ?? null,
            wheels: appliedMeasurement.wheels_json as Array<{
              axle: number;
              side: string;
              force: string;
              unit: string;
            }>,
          }
        : null,
    };
  }

  private async reconcileApplyIdentityRace(
    params: InspectionMeasurementIdentityRaceSignal['params'],
    now: Date,
  ) {
    const existing = await this.prisma.inspectionMeasurementIdentity.findFirst({
      where: params.identityKey,
    });
    if (!existing) {
      throw reviewRequired();
    }
    if (existing.semantic_digest !== params.semanticDigest) {
      await this.persistApplyConflict({
        tenantId: params.tenantId,
        siteId: params.siteId,
        importId: params.importId,
        actorUserId: params.actorUserId,
        previousState: 'READY_FOR_REVIEW',
        semanticDigest: params.semanticDigest,
        conflictingDigest: existing.semantic_digest,
        reason: 'MEASUREMENT_CONFLICT',
      });
      throw measurementConflict();
    }

    const measurement = await this.prisma.inspectionMeasurement.findFirst({
      where: {
        tenant_id: params.tenantId,
        measurement_identity_id: existing.id,
      },
    });
    if (!measurement) {
      throw reviewRequired();
    }

    const updated = await this.prisma.inspectionMeasurementImport.updateMany({
      where: {
        id: params.importId,
        tenant_id: params.tenantId,
        version: params.importVersion,
      },
      data: {
        state: 'APPLIED',
        applied_measurement_id: measurement.id,
        measurement_identity_id: existing.id,
        reviewed_by_user_id: params.actorUserId,
        reviewed_at: now,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) {
      throw reviewRequired();
    }

    return this.mapApplyResponse(measurement, true);
  }

  private async persistApplyConflict(params: {
    tenantId: string;
    siteId: string;
    importId: string;
    actorUserId: string;
    previousState: string;
    semanticDigest?: string;
    conflictingDigest?: string;
    reason: 'MEASUREMENT_CONFLICT' | 'REVIEW_REQUIRED';
  }) {
    await this.prisma.inspectionMeasurementImport.updateMany({
      where: { id: params.importId, tenant_id: params.tenantId },
      data: {
        error_code: params.reason,
        version: { increment: 1 },
      },
    });
    await this.appendSupportEvent({
      tenantId: params.tenantId,
      siteId: params.siteId,
      objectId: params.importId,
      reason: params.reason,
      actorUserId: params.actorUserId,
      sourceDigest: params.semanticDigest,
      detail: params.conflictingDigest
        ? { conflicting_digest: params.conflictingDigest }
        : undefined,
    });
  }

  private async appendSupportEvent(
    params: {
      tenantId: string;
      siteId: string;
      objectId: string;
      reason: string;
      actorUserId: string;
      sourceDigest?: string;
      detail?: Record<string, unknown>;
    },
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    await tx.inspectionSupportEvent.create({
      data: {
        tenant_id: params.tenantId,
        site_id: params.siteId,
        contract_kind: 'BRAKE_MEASUREMENT',
        object_id: params.objectId,
        reason: params.reason,
        actor_user_id: params.actorUserId,
        source_digest: params.sourceDigest ?? null,
        detail_redacted: (params.detail ??
          Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  }
}

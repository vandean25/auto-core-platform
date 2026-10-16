import { BadGatewayException, Inject, Injectable } from '@nestjs/common';
import { Prisma, type ExternalInspectionResult } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { assertInspectionImportWriteAccess } from './inspection-exchange.authorization.js';
import {
  inspectedOnInVienna,
  parsePlateValidUntil,
} from './inspection-exchange-canonical.js';
import {
  connectionNotFound,
  exchangeNotConfigured,
  externalResultConflict,
  importNotFound,
  resultNotFound,
  resultUnconfirmed,
  reviewRequired,
  accountMismatch,
  stationMismatch,
  vehicleIdentityMismatch,
} from './inspection-exchange.errors.js';
import { InspectionImportApplyConflictSignal } from './inspection-exchange-apply.signals.js';
import {
  previewFingerprint,
  semanticDigestForResult,
  sha256Utf8,
} from './inspection-exchange-fingerprint.js';
import {
  EBV_DMS_RESULT_READ_PORT,
  type EbvDmsResultReadPort,
} from './inspection-exchange.port.js';
import type { CanonicalInspectionResult } from './inspection-exchange.types.js';
import type { PreviewInspectionImportDto } from './dto/preview-inspection-import.dto.js';
import type { ApplyInspectionImportDto } from './dto/apply-inspection-import.dto.js';

const PREVIEW_TTL_MS = 15 * 60 * 1000;

type ResolvedPreview = {
  result: CanonicalInspectionResult;
  semanticDigest: string;
  fingerprint: string;
  originalDigest: string;
  inspectedOn: string;
  state: 'READY_FOR_REVIEW' | 'UNCONFIRMED' | 'CONFLICT';
};

@Injectable()
export class InspectionExchangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    @Inject(EBV_DMS_RESULT_READ_PORT)
    private readonly ebvPort: EbvDmsResultReadPort,
  ) {}

  async previewImport(
    vehicleId: string,
    dto: PreviewInspectionImportDto,
    now = new Date(),
  ) {
    assertInspectionImportWriteAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      select: {
        id: true,
        vin: true,
        first_registration_date: true,
        plate: true,
      },
    });
    if (!vehicle) {
      throw vehicleIdentityMismatch();
    }

    const connection = await this.prisma.inspectionSourceConnection.findFirst({
      where: {
        id: dto.connection_id,
        tenant_id: tenantId,
        site_id: siteId,
        is_active: true,
        read_enabled: true,
      },
    });
    if (!connection) {
      throw connectionNotFound();
    }

    const envelope = await this.ebvPort.fetchResult(
      {
        profileId: connection.profile_id,
        sourceAccountRef: connection.source_account_ref,
        sourceStationId: connection.source_station_id,
        bindingRevision: connection.binding_revision,
      },
      dto.native_result_reference,
    );

    if (envelope.status === 'NOT_CONFIGURED') {
      throw exchangeNotConfigured();
    }
    if (envelope.status === 'TIMEOUT' || envelope.status === 'ERROR') {
      throw new BadGatewayException({
        code: 'PROVIDER_READ_FAILED',
        retrieval_outcome: 'UNKNOWN',
      });
    }
    if (envelope.status === 'NOT_FOUND' || !envelope.canonical) {
      throw exchangeNotConfigured();
    }

    if (envelope.canonical.source_station_id !== connection.source_station_id) {
      throw stationMismatch();
    }
    if (
      envelope.canonical.source_account_ref !== connection.source_account_ref
    ) {
      throw accountMismatch();
    }

    const resolved = this.resolvePreview(
      envelope.canonical,
      envelope,
      vehicle,
      connection.binding_revision,
      now,
    );

    const existingByKey = await this.prisma.externalInspectionResult.findFirst({
      where: {
        tenant_id: tenantId,
        source_system: 'EBV',
        source_account_ref: envelope.canonical.source_account_ref,
        source_station_id: envelope.canonical.source_station_id,
        source_result_id: envelope.canonical.source_result_id,
        source_revision: envelope.canonical.source_revision,
      },
    });
    if (
      existingByKey &&
      existingByKey.semantic_digest !== resolved.semanticDigest
    ) {
      resolved.state = 'CONFLICT';
    }

    const importRow = await this.prisma.inspectionExchangeImport.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: vehicleId,
        connection_id: connection.id,
        workshop_order_id: dto.workshop_order_id ?? null,
        state: resolved.state,
        native_result_reference: dto.native_result_reference,
        preview_fingerprint: resolved.fingerprint,
        semantic_digest: resolved.semanticDigest,
        preview_expires_at: new Date(now.getTime() + PREVIEW_TTL_MS),
        created_by_user_id: user.id,
        error_code:
          resolved.state === 'UNCONFIRMED' ? 'RESULT_UNCONFIRMED' : null,
      },
    });

    await this.appendEvent({
      tenantId,
      siteId,
      importId: importRow.id,
      previousState: null,
      newState: resolved.state,
      actorUserId: user.id,
      semanticDigest: resolved.semanticDigest,
    });

    return this.mapImportPreview(importRow, resolved, connection.profile_id);
  }

  async applyImport(
    vehicleId: string,
    importId: string,
    dto: ApplyInspectionImportDto,
    now = new Date(),
  ) {
    assertInspectionImportWriteAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    try {
      return await this.prisma.$transaction(async (tx) => {
        const importRow = await tx.inspectionExchangeImport.findFirst({
          where: {
            id: importId,
            tenant_id: tenantId,
            site_id: siteId,
            vehicle_id: vehicleId,
          },
          include: { connection: true },
        });
        if (!importRow) {
          throw importNotFound(importId);
        }
        if (
          importRow.state === 'APPLIED' &&
          importRow.applied_external_result_id
        ) {
          const existing = await tx.externalInspectionResult.findFirst({
            where: {
              id: importRow.applied_external_result_id,
              tenant_id: tenantId,
            },
          });
          if (!existing) {
            throw importNotFound(importId);
          }
          return this.mapApplyResponse(existing, true);
        }
        if (importRow.state !== 'READY_FOR_REVIEW') {
          if (importRow.state === 'UNCONFIRMED') {
            throw resultUnconfirmed();
          }
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

        const envelope = await this.ebvPort.fetchResult(
          {
            profileId: importRow.connection.profile_id,
            sourceAccountRef: importRow.connection.source_account_ref,
            sourceStationId: importRow.connection.source_station_id,
            bindingRevision: importRow.connection.binding_revision,
          },
          importRow.native_result_reference,
        );
        if (!envelope.canonical || envelope.status !== 'RESULT') {
          throw reviewRequired();
        }

        const vehicle = await tx.vehicle.findFirst({
          where: { id: vehicleId, tenant_id: tenantId },
          select: {
            id: true,
            vin: true,
            first_registration_date: true,
            plate: true,
          },
        });
        if (!vehicle) {
          throw importNotFound(importId);
        }

        const resolved = this.resolvePreview(
          envelope.canonical,
          envelope,
          vehicle,
          importRow.connection.binding_revision,
          now,
        );
        if (resolved.state !== 'READY_FOR_REVIEW') {
          throw resultUnconfirmed();
        }
        if (resolved.fingerprint !== dto.fingerprint) {
          throw reviewRequired();
        }

        const existingByKey = await tx.externalInspectionResult.findFirst({
          where: {
            tenant_id: tenantId,
            source_system: 'EBV',
            source_account_ref: envelope.canonical.source_account_ref,
            source_station_id: envelope.canonical.source_station_id,
            source_result_id: envelope.canonical.source_result_id,
            source_revision: envelope.canonical.source_revision,
          },
        });
        if (existingByKey) {
          if (existingByKey.semantic_digest === resolved.semanticDigest) {
            await tx.inspectionExchangeImport.updateMany({
              where: {
                id: importId,
                tenant_id: tenantId,
                version: dto.version,
              },
              data: {
                state: 'APPLIED',
                applied_external_result_id: existingByKey.id,
                reviewed_by_user_id: user.id,
                reviewed_at: now,
                version: { increment: 1 },
              },
            });
            return this.mapApplyResponse(existingByKey, true);
          }
          throw new InspectionImportApplyConflictSignal({
            tenantId,
            siteId,
            importId,
            actorUserId: user.id,
            previousState: importRow.state,
            semanticDigest: resolved.semanticDigest,
            conflictingDigest: existingByKey.semantic_digest,
          });
        }

        if (
          envelope.canonical.occurrence_relation.kind === 'CORRECTION' ||
          envelope.canonical.occurrence_relation.kind === 'REVOCATION'
        ) {
          throw new InspectionImportApplyConflictSignal({
            tenantId,
            siteId,
            importId,
            actorUserId: user.id,
            previousState: importRow.state,
            semanticDigest: resolved.semanticDigest,
          });
        }

        let reportIdentityId: string | null = null;
        if (envelope.canonical.zbd_report_id) {
          const identity = await tx.inspectionReportIdentity.upsert({
            where: {
              tenant_id_zbd_report_id: {
                tenant_id: tenantId,
                zbd_report_id: envelope.canonical.zbd_report_id,
              },
            },
            create: {
              tenant_id: tenantId,
              zbd_report_id: envelope.canonical.zbd_report_id,
              vehicle_id: vehicleId,
            },
            update: {},
          });
          if (identity.vehicle_id !== vehicleId) {
            throw externalResultConflict();
          }
          reportIdentityId = identity.id;
        }

        const plateExpiry = envelope.canonical.plate
          ? parsePlateValidUntil(envelope.canonical.plate.valid_until)
          : null;

        let externalResult: ExternalInspectionResult;
        try {
          externalResult = await tx.externalInspectionResult.create({
            data: {
              tenant_id: tenantId,
              site_id: siteId,
              vehicle_id: vehicleId,
              connection_id: importRow.connection_id,
              import_id: importRow.id,
              report_identity_id: reportIdentityId,
              source_system: 'EBV',
              source_account_ref: envelope.canonical.source_account_ref,
              source_station_id: envelope.canonical.source_station_id,
              source_result_id: envelope.canonical.source_result_id,
              source_revision: envelope.canonical.source_revision,
              source_schema_version: envelope.canonical.source_schema_version,
              zbd_report_id: envelope.canonical.zbd_report_id,
              occurrence_kind: envelope.canonical.occurrence_relation.kind,
              occurrence_predecessor:
                envelope.canonical.occurrence_relation.predecessor ??
                Prisma.JsonNull,
              classification_evidence_ref:
                envelope.canonical.occurrence_relation
                  .classification_evidence_ref,
              vehicle_vin: envelope.canonical.vehicle.vin,
              vehicle_first_registration_on: new Date(
                `${envelope.canonical.vehicle.first_registration_on}T00:00:00.000Z`,
              ),
              vehicle_registration_plate:
                envelope.canonical.vehicle.registration_plate ?? null,
              inspected_at: new Date(envelope.canonical.inspected_at),
              inspected_on: new Date(`${resolved.inspectedOn}T00:00:00.000Z`),
              inspector_source_person_id:
                envelope.canonical.inspector.source_person_id,
              qualification_evidence_ref:
                envelope.canonical.inspector.qualification_evidence_ref ?? null,
              outcome: envelope.canonical.outcome,
              native_outcome_code:
                envelope.canonical.native_outcome_code ?? null,
              plate_number: envelope.canonical.plate?.number ?? null,
              plate_colour: envelope.canonical.plate?.colour ?? null,
              plate_valid_until_year: plateExpiry?.year ?? null,
              plate_valid_until_month: plateExpiry?.month ?? null,
              odometer_value: envelope.canonical.odometer?.value ?? null,
              odometer_unit: envelope.canonical.odometer?.unit ?? null,
              finality: envelope.canonical.finality,
              acknowledgement_state: envelope.canonical.acknowledgement.state,
              acknowledgement_evidence_type:
                envelope.canonical.acknowledgement.evidence_type ?? null,
              acknowledgement_evidence_ref:
                envelope.canonical.acknowledgement.evidence_ref ?? null,
              retrieved_at: now,
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
            const raced = await tx.externalInspectionResult.findFirst({
              where: {
                tenant_id: tenantId,
                source_system: 'EBV',
                source_account_ref: envelope.canonical.source_account_ref,
                source_station_id: envelope.canonical.source_station_id,
                source_result_id: envelope.canonical.source_result_id,
                source_revision: envelope.canonical.source_revision,
              },
            });
            if (!raced) {
              throw error;
            }
            if (raced.semantic_digest !== resolved.semanticDigest) {
              throw new InspectionImportApplyConflictSignal({
                tenantId,
                siteId,
                importId,
                actorUserId: user.id,
                previousState: importRow.state,
                semanticDigest: resolved.semanticDigest,
                conflictingDigest: raced.semantic_digest,
              });
            }
            await tx.inspectionExchangeImport.updateMany({
              where: {
                id: importId,
                tenant_id: tenantId,
                version: dto.version,
              },
              data: {
                state: 'APPLIED',
                applied_external_result_id: raced.id,
                reviewed_by_user_id: user.id,
                reviewed_at: now,
                version: { increment: 1 },
              },
            });
            return this.mapApplyResponse(raced, true);
          }
          throw error;
        }

        if (
          envelope.canonical.outcome === 'POSITIVE' &&
          envelope.canonical.finality === 'FINAL' &&
          envelope.canonical.acknowledgement.state === 'CONFIRMED' &&
          plateExpiry
        ) {
          await tx.vehicleInspectionRecord.create({
            data: {
              tenant_id: tenantId,
              vehicle_id: vehicleId,
              inspection_type: 'PICKERL_57A',
              inspected_on: new Date(`${resolved.inspectedOn}T00:00:00.000Z`),
              plaketten_valid_until_year: plateExpiry.year,
              plaketten_valid_until_month: plateExpiry.month,
              station_name: envelope.canonical.source_station_id,
              source: 'EBV_IMPORTED',
              external_inspection_result_id: externalResult.id,
              created_by_user_id: user.id,
            },
          });
        }

        await tx.inspectionExchangeImport.updateMany({
          where: { id: importId, tenant_id: tenantId, version: dto.version },
          data: {
            state: 'APPLIED',
            applied_external_result_id: externalResult.id,
            reviewed_by_user_id: user.id,
            reviewed_at: now,
            version: { increment: 1 },
          },
        });

        await this.appendEvent(
          {
            tenantId,
            siteId,
            importId: importRow.id,
            previousState: 'READY_FOR_REVIEW',
            newState: 'APPLIED',
            actorUserId: user.id,
            semanticDigest: resolved.semanticDigest,
            externalResultId: externalResult.id,
          },
          tx,
        );

        return this.mapApplyResponse(externalResult, false);
      });
    } catch (error: unknown) {
      if (error instanceof InspectionImportApplyConflictSignal) {
        await this.persistImportConflict(error.params);
        throw externalResultConflict();
      }
      throw error;
    }
  }

  private async persistImportConflict(params: {
    tenantId: string;
    siteId: string;
    importId: string;
    actorUserId: string;
    previousState: string;
    semanticDigest?: string;
    conflictingDigest?: string;
  }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.inspectionExchangeImport.updateMany({
        where: { id: params.importId, tenant_id: params.tenantId },
        data: { state: 'CONFLICT', error_code: 'EXTERNAL_RESULT_CONFLICT' },
      });
      await this.appendEvent(
        {
          tenantId: params.tenantId,
          siteId: params.siteId,
          importId: params.importId,
          previousState: params.previousState,
          newState: 'CONFLICT',
          actorUserId: params.actorUserId,
          semanticDigest: params.semanticDigest,
          conflictingDigest: params.conflictingDigest,
        },
        tx,
      );
    });
  }

  private mapApplyResponse(
    result: {
      id: string;
      outcome: string;
      finality: string;
      acknowledgement_state: string;
      inspected_on: Date;
    },
    replay: boolean,
  ) {
    return {
      result: {
        id: result.id,
        outcome: result.outcome,
        finality: result.finality,
        acknowledgement_state: result.acknowledgement_state,
        inspected_on: result.inspected_on.toISOString().slice(0, 10),
        qualification_state: 'NOT_VERIFIED',
      },
      replay,
    };
  }

  async listActiveConnections() {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);

    const rows = await this.prisma.inspectionSourceConnection.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        is_active: true,
        read_enabled: true,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        source_account_ref: true,
        source_station_id: true,
        profile_id: true,
        binding_revision: true,
      },
    });
    return { data: rows };
  }

  async listImports(vehicleId: string, page: number, limit: number) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);

    const take = Math.min(Math.max(limit, 1), 50);
    const skip = (Math.max(page, 1) - 1) * take;

    const [rows, total] = await Promise.all([
      this.prisma.inspectionExchangeImport.findMany({
        where: { tenant_id: tenantId, site_id: siteId, vehicle_id: vehicleId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.inspectionExchangeImport.count({
        where: { tenant_id: tenantId, site_id: siteId, vehicle_id: vehicleId },
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        state: row.state,
        native_result_reference: row.native_result_reference,
        preview_fingerprint: row.preview_fingerprint,
        semantic_digest: row.semantic_digest,
        preview_expires_at: row.preview_expires_at,
        error_code: row.error_code,
        version: row.version,
        createdAt: row.createdAt,
      })),
      meta: {
        total,
        page: Math.max(page, 1),
        pageSize: take,
        pageCount: Math.ceil(total / take),
      },
    };
  }

  async getExternalResult(vehicleId: string, resultId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);

    const result = await this.prisma.externalInspectionResult.findFirst({
      where: {
        id: resultId,
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: vehicleId,
      },
    });
    if (!result) {
      throw resultNotFound(resultId);
    }
    return {
      id: result.id,
      outcome: result.outcome,
      finality: result.finality,
      acknowledgement_state: result.acknowledgement_state,
      inspected_on: result.inspected_on.toISOString().slice(0, 10),
      source_result_id: result.source_result_id,
      source_revision: result.source_revision,
      zbd_report_id: result.zbd_report_id,
      semantic_digest: result.semantic_digest,
      qualification_state: 'NOT_VERIFIED',
    };
  }

  private resolvePreview(
    result: CanonicalInspectionResult,
    envelope: { trustedReceipt?: boolean; originalUtf8?: string },
    vehicle: {
      vin: string | null;
      first_registration_date: Date | null;
      plate: string | null;
    },
    bindingRevision: number,
    now: Date,
  ): ResolvedPreview {
    const normalizedVin = (vehicle.vin ?? '').trim().toUpperCase();
    if (
      result.vehicle.vin !== normalizedVin ||
      !vehicle.first_registration_date ||
      result.vehicle.first_registration_on !==
        vehicle.first_registration_date.toISOString().slice(0, 10)
    ) {
      throw vehicleIdentityMismatch();
    }
    if (
      result.vehicle.registration_plate &&
      vehicle.plate &&
      result.vehicle.registration_plate.trim().toUpperCase() !==
        vehicle.plate.trim().toUpperCase()
    ) {
      throw vehicleIdentityMismatch();
    }

    const inspectedAt = new Date(result.inspected_at);
    if (inspectedAt.getTime() > now.getTime()) {
      throw vehicleIdentityMismatch();
    }

    const semanticDigest = semanticDigestForResult(result);
    const fingerprint = previewFingerprint(
      semanticDigest,
      bindingRevision,
      result.vehicle.vin,
    );
    const originalDigest = sha256Utf8(
      envelope.originalUtf8 ?? JSON.stringify(result),
    );
    const inspectedOn = inspectedOnInVienna(result.inspected_at);

    const trusted =
      envelope.trustedReceipt === true &&
      result.acknowledgement.state === 'CONFIRMED' &&
      result.finality === 'FINAL';

    if (
      result.occurrence_relation.kind === 'CORRECTION' ||
      result.occurrence_relation.kind === 'REVOCATION'
    ) {
      return {
        result,
        semanticDigest,
        fingerprint,
        originalDigest,
        inspectedOn,
        state: 'CONFLICT',
      };
    }

    if (
      result.outcome === 'UNKNOWN' ||
      result.finality === 'UNKNOWN' ||
      result.acknowledgement.state === 'UNKNOWN'
    ) {
      return {
        result,
        semanticDigest,
        fingerprint,
        originalDigest,
        inspectedOn,
        state: 'UNCONFIRMED',
      };
    }

    if (result.outcome === 'POSITIVE' && !result.plate?.valid_until) {
      return {
        result,
        semanticDigest,
        fingerprint,
        originalDigest,
        inspectedOn,
        state: 'UNCONFIRMED',
      };
    }

    if (!trusted || result.acknowledgement.state !== 'CONFIRMED') {
      return {
        result,
        semanticDigest,
        fingerprint,
        originalDigest,
        inspectedOn,
        state: 'UNCONFIRMED',
      };
    }

    return {
      result,
      semanticDigest,
      fingerprint,
      originalDigest,
      inspectedOn,
      state: 'READY_FOR_REVIEW',
    };
  }

  private mapImportPreview(
    importRow: {
      id: string;
      state: string;
      version: number;
      preview_expires_at: Date | null;
      preview_fingerprint: string | null;
    },
    resolved: ResolvedPreview,
    profileId: string,
  ) {
    return {
      id: importRow.id,
      state: importRow.state,
      version: importRow.version,
      preview_expires_at: importRow.preview_expires_at,
      fingerprint: importRow.preview_fingerprint,
      reviewed_fields: {
        outcome: resolved.result.outcome,
        finality: resolved.result.finality,
        acknowledgement_state: resolved.result.acknowledgement.state,
        inspected_on: resolved.inspectedOn,
        plate_valid_until: resolved.result.plate?.valid_until ?? null,
        source: profileId === 'TEST_ONLY' ? 'EBV_IMPORTED' : 'EBV_IMPORTED',
        qualification_state: 'NOT_VERIFIED',
        display_unconfirmed:
          importRow.state === 'UNCONFIRMED' ? 'NICHT_BESTÄTIGT' : null,
      },
    };
  }

  private async appendEvent(
    params: {
      tenantId: string;
      siteId: string;
      importId: string;
      previousState: string | null;
      newState: string;
      actorUserId: string;
      semanticDigest?: string;
      externalResultId?: string;
      conflictingDigest?: string;
    },
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    await tx.inspectionExchangeEvent.create({
      data: {
        tenant_id: params.tenantId,
        site_id: params.siteId,
        import_id: params.importId,
        external_result_id: params.externalResultId ?? null,
        previous_state: params.previousState as never,
        new_state: params.newState as never,
        actor_user_id: params.actorUserId,
        semantic_digest: params.semanticDigest ?? null,
        conflicting_digest: params.conflictingDigest ?? null,
      },
    });
  }
}

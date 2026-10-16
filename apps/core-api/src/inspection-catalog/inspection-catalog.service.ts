import { Injectable } from '@nestjs/common';
import {
  InspectionCatalogueImportState,
  InspectionCatalogueSourceKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import {
  assertCatalogueActivationAccess,
  assertCatalogueReadAccess,
} from './inspection-catalog.authorization.js';
import {
  entryLocator,
  intervalsOverlap,
  manifestContentSha256,
  parseViennaDate,
  previewFingerprint,
  resolveCatalogueReference,
  validateManifest,
} from './inspection-catalog-canonical.js';
import {
  catalogueImportNotFound,
  catalogueNotConfigured,
  outOfScope,
  reviewRequired,
  sourceConflict,
  staleCatalog,
  unknownCode,
  workshopInspectionNotFound,
} from './inspection-catalog.errors.js';
import { InspectionCatalogueActivateConflictSignal } from './inspection-catalog-activate.signals.js';
import {
  resolveBuiltinManifestReference,
  STATUTORY_MANIFEST_REFERENCE,
} from './inspection-catalog-synthetic-fixtures.js';
import type { CatalogueManifest } from './inspection-catalog.types.js';
import type { PreviewInspectionCatalogueDto } from './dto/preview-inspection-catalogue.dto.js';
import type { ActivateInspectionCatalogueDto } from './dto/activate-inspection-catalogue.dto.js';
import type { CreateInspectionFindingReferenceDto } from './dto/inspection-catalogue-response.dto.js';

const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_REFERENCE_CODES = 50;

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

@Injectable()
export class InspectionCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async previewCatalogue(dto: PreviewInspectionCatalogueDto, now = new Date()) {
    assertCatalogueActivationAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const loaded = this.loadManifest(dto.manifest_reference);
    if (loaded === 'NOT_CONFIGURED') {
      throw catalogueNotConfigured();
    }

    const manifest = loaded;
    validateManifest(manifest);
    if (manifest.source_kind === 'TEST_ONLY' && isProductionRuntime()) {
      throw catalogueNotConfigured();
    }

    const digest = manifestContentSha256(manifest);
    const fingerprint = previewFingerprint(
      digest,
      dto.manifest_reference,
      siteId,
    );

    let state: InspectionCatalogueImportState = 'READY_FOR_ACTIVATION';
    let errorCode: string | null = null;

    const overlap = await this.findOverlappingActiveVersion(
      tenantId,
      siteId,
      manifest,
    );
    if (overlap === 'SOURCE_CONFLICT') {
      state = 'CONFLICT';
      errorCode = 'SOURCE_CONFLICT';
    }

    const importRow = await this.prisma.inspectionCatalogueImport.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        state,
        manifest_reference: dto.manifest_reference,
        preview_fingerprint: fingerprint,
        manifest_digest: digest,
        preview_expires_at: new Date(now.getTime() + PREVIEW_TTL_MS),
        error_code: errorCode,
        created_by_user_id: user.id,
      },
    });

    await this.appendSupportEvent({
      tenantId,
      siteId,
      objectId: importRow.id,
      reason: state,
      actorUserId: user.id,
      sourceDigest: digest,
    });

    return this.mapPreview(importRow, manifest);
  }

  async activateCatalogue(
    importId: string,
    dto: ActivateInspectionCatalogueDto,
    now = new Date(),
  ) {
    assertCatalogueActivationAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const importRow = await this.prisma.inspectionCatalogueImport.findFirst({
      where: { id: importId, tenant_id: tenantId, site_id: siteId },
    });
    if (!importRow) {
      throw catalogueImportNotFound(importId);
    }

    if (
      importRow.preview_expires_at &&
      importRow.preview_expires_at.getTime() < now.getTime()
    ) {
      throw reviewRequired();
    }
    if (importRow.preview_fingerprint !== dto.fingerprint) {
      throw reviewRequired();
    }

    const loaded = this.loadManifest(importRow.manifest_reference);
    if (loaded === 'NOT_CONFIGURED') {
      throw catalogueNotConfigured();
    }
    const manifest = loaded;

    if (importRow.state === 'CONFLICT') {
      throw sourceConflict();
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.inspectionCatalogueImport.findFirst({
          where: {
            id: importId,
            tenant_id: tenantId,
            version: dto.version,
          },
        });
        if (!locked || locked.preview_fingerprint !== dto.fingerprint) {
          throw new InspectionCatalogueActivateConflictSignal({
            tenantId,
            siteId,
            importId,
            actorUserId: user.id,
            manifestDigest: locked?.manifest_digest ?? undefined,
          });
        }

        const overlap = await this.findOverlappingActiveVersion(
          tenantId,
          siteId,
          manifest,
          tx,
        );
        if (overlap === 'SOURCE_CONFLICT') {
          throw sourceConflict();
        }

        const existingVersion = await tx.inspectionCatalogueVersion.findFirst({
          where: {
            tenant_id: tenantId,
            content_sha256: importRow.manifest_digest ?? undefined,
            source_version: manifest.source_version,
          },
        });

        const existingSiteActivation =
          existingVersion &&
          (await tx.tenantInspectionCatalogueActivation.findFirst({
            where: {
              tenant_id: tenantId,
              site_id: siteId,
              catalogue_version_id: existingVersion.id,
              deactivated_at: null,
            },
          }));

        let version = existingVersion;
        if (!version) {
          const createdVersion = await tx.inspectionCatalogueVersion.create({
            data: {
              tenant_id: tenantId,
              schema_version: manifest.schema_version,
              source_kind: manifest.source_kind,
              publisher: manifest.publisher,
              source_uri: manifest.source_uri,
              source_document_id: manifest.source_document_id,
              source_version: manifest.source_version,
              valid_from: parseViennaDate(manifest.valid_from),
              valid_to: manifest.valid_to
                ? parseViennaDate(manifest.valid_to)
                : null,
              retrieved_at: new Date(manifest.retrieved_at),
              verified_current_at: new Date(manifest.verified_current_at),
              recheck_after: new Date(manifest.recheck_after),
              content_sha256: importRow.manifest_digest!,
              coverage: manifest.coverage,
              rights: manifest.rights,
              approval_evidence_ref: manifest.approval_evidence_ref,
            },
          });
          version = createdVersion;

          if (manifest.positions.length > 0) {
            await tx.inspectionCatalogueEntry.createMany({
              data: manifest.positions.map((position) => ({
                tenant_id: tenantId,
                catalogue_version_id: createdVersion.id,
                position_id: position.position_id,
                entry_id: position.entry_id,
                entry_locator: entryLocator(position),
                label: position.label,
                allowed_groups: position.allowed_groups,
                vehicle_scope: position.vehicle_scope,
              })),
            });
          }
        }

        if (!existingSiteActivation) {
          await tx.tenantInspectionCatalogueActivation.updateMany({
            where: {
              tenant_id: tenantId,
              site_id: siteId,
              source_kind: manifest.source_kind,
              deactivated_at: null,
            },
            data: { deactivated_at: now },
          });

          await tx.tenantInspectionCatalogueActivation.create({
            data: {
              tenant_id: tenantId,
              site_id: siteId,
              catalogue_version_id: version.id,
              source_kind: manifest.source_kind,
              activated_at: now,
              activated_by_user_id: user.id,
            },
          });
        }

        await tx.inspectionCatalogueImport.updateMany({
          where: { id: importId, tenant_id: tenantId, version: dto.version },
          data: {
            state: 'ACTIVATED',
            staged_version_id: version.id,
            activated_by_user_id: user.id,
            activated_at: now,
            version: { increment: 1 },
          },
        });

        await this.appendSupportEvent(
          {
            tenantId,
            siteId,
            objectId: version.id,
            reason: 'ACTIVATED',
            actorUserId: user.id,
            sourceDigest: importRow.manifest_digest ?? undefined,
          },
          tx,
        );

        return {
          catalogue_version_id: version.id,
          source_version: version.source_version,
          source_kind: version.source_kind,
          coverage: version.coverage,
          replay: Boolean(existingSiteActivation),
        };
      });
    } catch (error: unknown) {
      if (error instanceof InspectionCatalogueActivateConflictSignal) {
        throw reviewRequired();
      }
      throw error;
    }
  }

  async resolveReferences(
    codes: Array<{ position_id: string; entry_id?: string | null }>,
    options: {
      inspection_time?: string;
      vehicle_class?: string | null;
      catalogue_version_id?: string | null;
      for_current_use?: boolean;
    },
    now = new Date(),
  ) {
    assertCatalogueReadAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);

    const limited = codes.slice(0, MAX_REFERENCE_CODES);
    const inspectionTime = options.inspection_time
      ? new Date(options.inspection_time)
      : now;
    const forCurrentUse = options.for_current_use ?? true;

    const version = await this.resolveVersionForLookup(
      tenantId,
      siteId,
      options.catalogue_version_id,
    );

    if (!version) {
      return {
        data: limited.map((code) => ({
          position_id: code.position_id,
          entry_id: code.entry_id ?? null,
          status: 'NOT_CONFIGURED',
          label: null,
          source_kind: 'STATUTORY_REFERENCE',
          coverage: 'SUBSET',
          catalogue_version_id: null,
          source_version: null,
          recheck_after: null,
          currentness_stale: true,
        })),
      };
    }

    const manifest = this.versionToManifest(version);
    const staleCurrent =
      forCurrentUse &&
      inspectionTime.getTime() >= version.recheck_after.getTime();

    const entryByLocator = new Map(
      version.entries.map((entry) => [entry.entry_locator, entry]),
    );

    const data = limited.map((code) => {
      const status = resolveCatalogueReference({
        manifest,
        request: code,
        inspectionTime,
        vehicleClass: options.vehicle_class,
        forCurrentUse,
        lookupPurpose: 'scoped_recommendation',
      });

      const locator = code.entry_id
        ? `${code.position_id}#${code.entry_id}`
        : code.position_id;
      const matched = entryByLocator.get(locator);

      return {
        position_id: code.position_id,
        entry_id: code.entry_id ?? null,
        status:
          staleCurrent && status === 'RESOLVED' ? 'STALE_CATALOG' : status,
        label: matched?.label ?? null,
        source_kind: version.source_kind,
        coverage: version.coverage,
        catalogue_version_id: version.id,
        source_version: version.source_version,
        recheck_after: version.recheck_after.toISOString(),
        currentness_stale: staleCurrent,
      };
    });

    return { data };
  }

  async createFindingReference(
    dto: CreateInspectionFindingReferenceDto,
    now = new Date(),
  ) {
    assertCatalogueReadAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const inspection = await this.prisma.workshopInspection.findFirst({
      where: {
        tenant_id: tenantId,
        workshop_order_id: dto.workshop_order_id,
        workshop_task_id: dto.workshop_task_id,
        workshop_order: { site_id: siteId },
      },
      select: { id: true },
    });
    if (!inspection) {
      throw workshopInspectionNotFound();
    }

    const version = await this.resolveVersionForLookup(tenantId, siteId, null);
    if (!version) {
      throw catalogueNotConfigured();
    }

    const manifest = this.versionToManifest(version);
    const status = resolveCatalogueReference({
      manifest,
      request: {
        position_id: dto.position_id,
        entry_id: dto.entry_id ?? null,
      },
      inspectionTime: now,
      vehicleClass: dto.vehicle_class ?? null,
      forCurrentUse: true,
      lookupPurpose:
        dto.entry_id == null ? 'position_only' : 'scoped_recommendation',
    });
    if (status === 'UNKNOWN_CODE') {
      throw unknownCode();
    }
    if (status === 'STALE_CATALOG') {
      throw staleCatalog();
    }
    if (status === 'OUT_OF_SCOPE') {
      throw outOfScope();
    }
    if (status !== 'RESOLVED') {
      throw catalogueNotConfigured();
    }

    const locator = dto.entry_id
      ? `${dto.position_id}#${dto.entry_id}`
      : dto.position_id;
    const entry = version.entries.find((row) => row.entry_locator === locator);
    if (!entry) {
      throw catalogueNotConfigured();
    }

    const reference = await this.prisma.inspectionFindingReference.create({
      data: {
        tenant_id: tenantId,
        site_id: siteId,
        workshop_inspection_id: inspection.id,
        catalogue_version_id: version.id,
        position_id: dto.position_id,
        entry_id: dto.entry_id ?? null,
        label_snapshot: entry.label,
        allowed_groups_snapshot: entry.allowed_groups as Prisma.InputJsonValue,
        provenance_snapshot: {
          source_kind: version.source_kind,
          source_version: version.source_version,
          source_uri: version.source_uri,
          coverage: version.coverage,
          content_sha256: version.content_sha256,
          recheck_after: version.recheck_after.toISOString(),
        },
        human_finding_label: dto.human_finding_label ?? null,
        created_by_user_id: user.id,
      },
    });

    return {
      id: reference.id,
      position_id: reference.position_id,
      entry_id: reference.entry_id,
      label_snapshot: reference.label_snapshot,
      source_version: version.source_version,
      source_kind: version.source_kind,
      coverage: version.coverage,
    };
  }

  async listFindingReferences(
    workshopInspectionId: string,
    page = 1,
    limit = 20,
  ) {
    assertCatalogueReadAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);

    const inspection = await this.prisma.workshopInspection.findFirst({
      where: {
        id: workshopInspectionId,
        tenant_id: tenantId,
        workshop_order: { site_id: siteId },
      },
      select: { id: true },
    });
    if (!inspection) {
      throw workshopInspectionNotFound();
    }

    const take = Math.min(Math.max(limit, 1), MAX_REFERENCE_CODES);
    const skip = (Math.max(page, 1) - 1) * take;

    const [rows, total] = await Promise.all([
      this.prisma.inspectionFindingReference.findMany({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          workshop_inspection_id: workshopInspectionId,
        },
        include: {
          catalogueVersion: {
            select: {
              source_version: true,
              source_kind: true,
              coverage: true,
              recheck_after: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
      this.prisma.inspectionFindingReference.count({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          workshop_inspection_id: workshopInspectionId,
        },
      }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        position_id: row.position_id,
        entry_id: row.entry_id,
        label_snapshot: row.label_snapshot,
        source_version: row.catalogueVersion.source_version,
        source_kind: row.catalogueVersion.source_kind,
        coverage: row.catalogueVersion.coverage,
        recheck_after: row.catalogueVersion.recheck_after.toISOString(),
        provenance_snapshot: row.provenance_snapshot,
        human_finding_label: row.human_finding_label,
      })),
      meta: {
        total,
        page: Math.max(page, 1),
        pageSize: take,
        pageCount: Math.ceil(total / take) || 0,
      },
    };
  }

  private loadManifest(
    manifestReference: string,
  ): CatalogueManifest | 'NOT_CONFIGURED' {
    if (manifestReference === STATUTORY_MANIFEST_REFERENCE) {
      return resolveBuiltinManifestReference(manifestReference);
    }
    return resolveBuiltinManifestReference(manifestReference);
  }

  private async findOverlappingActiveVersion(
    tenantId: string,
    siteId: string,
    manifest: CatalogueManifest,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<'OK' | 'SOURCE_CONFLICT'> {
    const activations = await tx.tenantInspectionCatalogueActivation.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        source_kind: manifest.source_kind,
        deactivated_at: null,
      },
      include: { catalogueVersion: true },
    });

    const candidateFrom = parseViennaDate(manifest.valid_from);
    const candidateTo = manifest.valid_to
      ? parseViennaDate(manifest.valid_to)
      : null;

    for (const activation of activations) {
      const version = activation.catalogueVersion;
      if (
        intervalsOverlap(
          candidateFrom,
          candidateTo,
          version.valid_from,
          version.valid_to,
        ) &&
        version.source_version !== manifest.source_version
      ) {
        return 'SOURCE_CONFLICT';
      }
    }
    return 'OK';
  }

  private async resolveVersionForLookup(
    tenantId: string,
    siteId: string,
    catalogueVersionId?: string | null,
  ) {
    if (catalogueVersionId) {
      return this.prisma.inspectionCatalogueVersion.findFirst({
        where: { tenant_id: tenantId, id: catalogueVersionId },
        include: { entries: true },
      });
    }

    const activation =
      await this.prisma.tenantInspectionCatalogueActivation.findFirst({
        where: {
          tenant_id: tenantId,
          site_id: siteId,
          deactivated_at: null,
        },
        orderBy: { activated_at: 'desc' },
        include: {
          catalogueVersion: { include: { entries: true } },
        },
      });

    if (!activation) {
      return null;
    }

    return {
      ...activation.catalogueVersion,
      entries: activation.catalogueVersion.entries,
    };
  }

  private versionToManifest(version: {
    schema_version: string;
    source_kind: InspectionCatalogueSourceKind;
    publisher: string;
    source_uri: string;
    source_document_id: string;
    source_version: string;
    valid_from: Date;
    valid_to: Date | null;
    retrieved_at: Date;
    verified_current_at: Date;
    recheck_after: Date;
    coverage: string;
    rights: string;
    approval_evidence_ref: string | null;
    entries: Array<{
      position_id: string;
      entry_id: string | null;
      label: string;
      allowed_groups: unknown;
      vehicle_scope: string;
    }>;
  }): CatalogueManifest {
    return {
      schema_version: 'acp-inspection-catalog/1',
      source_kind: version.source_kind,
      publisher: version.publisher,
      source_uri: version.source_uri,
      source_document_id: version.source_document_id,
      source_version: version.source_version,
      valid_from: version.valid_from.toISOString().slice(0, 10),
      valid_to: version.valid_to
        ? version.valid_to.toISOString().slice(0, 10)
        : null,
      retrieved_at: version.retrieved_at.toISOString(),
      verified_current_at: version.verified_current_at.toISOString(),
      recheck_after: version.recheck_after.toISOString(),
      coverage: version.coverage as CatalogueManifest['coverage'],
      rights: version.rights,
      approval_evidence_ref: version.approval_evidence_ref,
      positions: version.entries.map((entry) => ({
        position_id: entry.position_id,
        entry_id: entry.entry_id,
        label: entry.label,
        allowed_groups: Array.isArray(entry.allowed_groups)
          ? (entry.allowed_groups as string[])
          : [],
        vehicle_scope: entry.vehicle_scope,
      })),
    };
  }

  private mapPreview(
    importRow: {
      id: string;
      state: InspectionCatalogueImportState;
      manifest_reference: string;
      preview_fingerprint: string | null;
      manifest_digest: string | null;
      preview_expires_at: Date | null;
      error_code: string | null;
      version: number;
    },
    manifest: CatalogueManifest,
  ) {
    return {
      id: importRow.id,
      state: importRow.state,
      manifest_reference: importRow.manifest_reference,
      fingerprint: importRow.preview_fingerprint,
      manifest_digest: importRow.manifest_digest,
      preview_expires_at: importRow.preview_expires_at?.toISOString() ?? null,
      error_code: importRow.error_code,
      version: importRow.version,
      source_kind: manifest.source_kind,
      source_version: manifest.source_version,
      coverage: manifest.coverage,
      recheck_after: manifest.recheck_after,
    };
  }

  private async appendSupportEvent(
    params: {
      tenantId: string;
      siteId: string;
      objectId: string;
      reason: string;
      actorUserId: string;
      sourceDigest?: string;
    },
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    await tx.inspectionSupportEvent.create({
      data: {
        tenant_id: params.tenantId,
        site_id: params.siteId,
        contract_kind: 'INSPECTION_CATALOGUE',
        object_id: params.objectId,
        source_digest: params.sourceDigest ?? null,
        reason: params.reason,
        actor_user_id: params.actorUserId,
      },
    });
  }
}

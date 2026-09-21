import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditActorType, AuditLogAction, type LegalEntityAccountingProfile } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../../site/site.authorization.js';
import {
  assertClosedExportPeriod,
  assertValidExportDateRange,
  rangesOverlap,
} from './accounting-export-period.js';
import {
  buildManifestDocuments,
  collectUniqueBlockers,
  computeSignedTotals,
  flattenBookingRows,
  loadAccountingExportCandidates,
} from './accounting-export-candidates.js';
import {
  computePreviewHash,
  hashAccountingExportRequest,
} from './accounting-export-hash.js';
import {
  assertCompleteAccountingExportScope,
  listAccountingExportSites,
} from './accounting-export-scope.js';
import type { AccountingExportProfileSnapshot } from './accounting-export.types.js';
import {
  buildAccountingExportFilename,
  serializeDatevBuchungsstapel,
} from './datev-serializer.js';
import {
  DATEV_MAX_CSV_BYTES,
  DATEV_MAX_DOCUMENTS_PER_RUN,
} from './datev-format.constants.js';
import type {
  AccountingExportDetailDto,
  AccountingExportListQueryDto,
  GenerateAccountingExportDto,
  PreviewAccountingExportDto,
} from './dto/accounting-export.dto.js';

function toProfileSnapshot(
  profile: LegalEntityAccountingProfile,
): AccountingExportProfileSnapshot {
  return {
    version: profile.version,
    profileCode: profile.profile_code,
    formatVersion: profile.format_version,
    chart: profile.chart,
    accountLength: profile.account_length,
    advisorNumber: profile.advisor_number,
    clientNumber: profile.client_number,
    fiscalYearStartMonth: profile.fiscal_year_start_month,
    defaultDebtorAccount: profile.default_debtor_account,
    isEnabled: profile.is_enabled,
  };
}

@Injectable()
export class AccountingExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async preview(dto: PreviewAccountingExportDto) {
    const context = await this.buildValidatedContext(dto);
    const bookingRows = flattenBookingRows(context.candidates);
    const blockers = collectUniqueBlockers(context.candidates);
    const manifest = buildManifestDocuments(context.candidates);
    const previewHash = computePreviewHash({
      legalEntityId: dto.legalEntityId,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      profileVersion: context.profile.version,
      siteIds: context.sites.map((site) => site.id),
      documents: manifest,
    });

    return {
      legalEntityId: dto.legalEntityId,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      profileVersion: context.profile.version,
      previewHash,
      documentCount: context.candidates.length,
      rowCount: bookingRows.length,
      totals: computeSignedTotals(bookingRows),
      blockers,
      overlaps: context.overlaps,
      canGenerate:
        blockers.length === 0 &&
        bookingRows.length > 0 &&
        context.profile.is_enabled,
    };
  }

  async generate(dto: GenerateAccountingExportDto) {
    const tenantId = await this.tenantContext.getTenantId();
    assertTenantAdmin(this.tenantContext);
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const requestHash = hashAccountingExportRequest(dto);
    const existing = await this.prisma.accountingExport.findFirst({
      where: {
        tenant_id: tenantId,
        idempotency_key: dto.idempotencyKey,
      },
    });

    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new ConflictException({
          code: 'EXPORT_IDEMPOTENCY_CONFLICT',
          message:
            'This idempotency key was already used with a different request body.',
        });
      }
      return this.serializeCreatedExport(existing);
    }

    const context = await this.buildValidatedContext(dto);
    const bookingRows = flattenBookingRows(context.candidates);
    const blockers = collectUniqueBlockers(context.candidates);
    const manifest = buildManifestDocuments(context.candidates);
    const previewHash = computePreviewHash({
      legalEntityId: dto.legalEntityId,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      profileVersion: context.profile.version,
      siteIds: context.sites.map((site) => site.id),
      documents: manifest,
    });

    if (previewHash !== dto.previewHash) {
      throw new ConflictException({
        code: 'EXPORT_PREVIEW_STALE',
        message: 'Preview hash is stale. Run preview again before generating.',
      });
    }

    if (context.profile.version !== dto.profileVersion) {
      throw new ConflictException({
        code: 'EXPORT_PREVIEW_STALE',
        message: 'Accounting profile version is stale.',
      });
    }

    if (!context.profile.is_enabled) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_PROFILE_DISABLED',
        message: 'DATEV export profile is not enabled.',
      });
    }

    if (blockers.length > 0) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_BLOCKED',
        message: 'Export contains blocking documents.',
        blockers,
      });
    }

    if (bookingRows.length === 0) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_EMPTY_PERIOD',
        message: 'No booking rows are available for the selected period.',
      });
    }

    if (context.candidates.length > DATEV_MAX_DOCUMENTS_PER_RUN) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_RANGE_TOO_LARGE',
        message: 'Export range exceeds the maximum document count.',
      });
    }

    if (context.overlaps.length > 0 && !dto.acknowledgeOverlap) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_OVERLAP_NOT_ACKNOWLEDGED',
        message: 'Overlapping export runs require acknowledgement.',
        overlaps: context.overlaps,
      });
    }

    const createdAt = new Date();
    const profileSnapshot = toProfileSnapshot(context.profile);
    const serialized = serializeDatevBuchungsstapel({
      profile: profileSnapshot,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      createdAt,
      rows: bookingRows,
    });

    if (serialized.byteLength > DATEV_MAX_CSV_BYTES) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_RANGE_TOO_LARGE',
        message: 'Encoded CSV exceeds the maximum export size.',
      });
    }

    const exportId = randomUUID();

    const filename = buildAccountingExportFilename({
      legalEntityId: dto.legalEntityId,
      dateFrom: dto.dateFrom,
      dateTo: dto.dateTo,
      runId: exportId,
    });

    const created = await this.prisma.$transaction(async (tx) => {
      await assertCompleteAccountingExportScope(
        this.prisma,
        tenantId,
        currentUser.id,
        context.sites,
      );

      const settings = await tx.financeSettings.findFirst({
        where: { tenant_id: tenantId },
        select: { lock_date: true },
      });
      assertClosedExportPeriod(context.dateTo, settings?.lock_date ?? null);

      const profile = await tx.legalEntityAccountingProfile.findFirst({
        where: {
          tenant_id: tenantId,
          legal_entity_id: dto.legalEntityId,
        },
      });
      if (!profile || profile.version !== dto.profileVersion) {
        throw new ConflictException({
          code: 'EXPORT_PREVIEW_STALE',
          message: 'Accounting profile version changed during generation.',
        });
      }

      const row = await tx.accountingExport.create({
        data: {
          id: exportId,
          tenant_id: tenantId,
          legal_entity_id: dto.legalEntityId,
          created_by_user_id: currentUser.id,
          date_from: context.dateFrom,
          date_to: context.dateTo,
          profile_snapshot: profileSnapshot,
          document_manifest: manifest,
          site_ids: context.sites.map((site) => site.id),
          file_bytes: new Uint8Array(serialized.bytes),
          file_sha256: serialized.sha256,
          byte_length: serialized.byteLength,
          row_count: serialized.rowCount,
          document_count: context.candidates.length,
          idempotency_key: dto.idempotencyKey,
          request_hash: requestHash,
          createdAt,
        },
      });

      await tx.auditLog.create({
        data: {
          tenant_id: tenantId,
          entity_type: 'AccountingExport',
          entity_id: row.id,
          action: AuditLogAction.CREATE,
          actor_user_id: currentUser.id,
          actor_email: this.tenantContext.getAuthenticatedUser()?.email ?? null,
          actor_role: this.tenantContext.getAuthenticatedUser()?.role ?? null,
          actor_type: AuditActorType.USER,
          after: {
            event: 'accounting_export.generated',
            legalEntityId: dto.legalEntityId,
            dateFrom: dto.dateFrom,
            dateTo: dto.dateTo,
            sha256: serialized.sha256,
            filename,
            documentCount: context.candidates.length,
            rowCount: serialized.rowCount,
          },
        },
      });

      return row;
    });

    return this.serializeCreatedExport(created, filename);
  }

  async list(query: AccountingExportListQueryDto = {}) {
    const tenantId = await this.tenantContext.getTenantId();
    assertTenantAdmin(this.tenantContext);
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const search = query.search?.trim();

    const exports = await this.prisma.accountingExport.findMany({
      where: {
        tenant_id: tenantId,
        ...(query.legalEntityId
          ? { legal_entity_id: query.legalEntityId }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    const authorized: typeof exports = [];
    for (const exportRun of exports) {
      const siteIds = Array.isArray(exportRun.site_ids)
        ? (exportRun.site_ids as string[])
        : [];
      const sites = await this.prisma.site.findMany({
        where: { tenant_id: tenantId, id: { in: siteIds } },
        select: { id: true, code: true, name: true, is_active: true },
      });

      try {
        await assertCompleteAccountingExportScope(
          this.prisma,
          tenantId,
          currentUser.id,
          sites.map((site) => ({
            id: site.id,
            code: site.code,
            name: site.name,
            isActive: site.is_active,
          })),
        );
      } catch {
        continue;
      }

      if (
        search &&
        ![
          exportRun.id,
          exportRun.legal_entity_id,
          exportRun.file_sha256,
        ].some((value) => value.toLowerCase().includes(search.toLowerCase()))
      ) {
        continue;
      }

      authorized.push(exportRun);
    }

    const total = authorized.length;
    const pageRows = authorized.slice((page - 1) * limit, page * limit);

    return {
      data: pageRows.map((row) => this.serializeSummary(row)),
      meta: {
        total,
        page,
        limit,
        pageCount: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(id: string): Promise<AccountingExportDetailDto> {
    const exportRun = await this.loadAuthorizedExport(id);
    const siteIds = Array.isArray(exportRun.site_ids)
      ? (exportRun.site_ids as string[])
      : [];

    return {
      ...this.serializeSummary(exportRun),
      profileSnapshot: exportRun.profile_snapshot as Record<string, unknown>,
      documentManifest: exportRun.document_manifest as Record<string, unknown>,
      siteIds,
    };
  }

  async download(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const exportRun = await this.loadAuthorizedExport(id);
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    await this.prisma.auditLog.create({
      data: {
        tenant_id: tenantId,
        entity_type: 'AccountingExport',
        entity_id: exportRun.id,
        action: AuditLogAction.UPDATE,
        actor_user_id: currentUser.id,
        actor_email: this.tenantContext.getAuthenticatedUser()?.email ?? null,
        actor_role: this.tenantContext.getAuthenticatedUser()?.role ?? null,
        actor_type: AuditActorType.USER,
        after: {
          event: 'accounting_export.downloaded',
          sha256: exportRun.file_sha256,
          byteLength: exportRun.byte_length,
        },
      },
    });

    const filename = buildAccountingExportFilename({
      legalEntityId: exportRun.legal_entity_id,
      dateFrom: exportRun.date_from.toISOString().slice(0, 10),
      dateTo: exportRun.date_to.toISOString().slice(0, 10),
      runId: exportRun.id,
    });

    return {
      filename,
      bytes: Buffer.from(exportRun.file_bytes),
      sha256: exportRun.file_sha256,
      byteLength: exportRun.byte_length,
    };
  }

  private async buildValidatedContext(dto: PreviewAccountingExportDto) {
    const tenantId = await this.tenantContext.getTenantId();
    assertTenantAdmin(this.tenantContext);
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const entity = await this.prisma.legalEntity.findFirst({
      where: { id: dto.legalEntityId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!entity) {
      throw new NotFoundException('Legal entity not found');
    }

    const { dateFrom, dateTo } = assertValidExportDateRange(
      dto.dateFrom,
      dto.dateTo,
    );

    const settings = await this.prisma.financeSettings.findFirst({
      where: { tenant_id: tenantId },
      select: { lock_date: true },
    });
    assertClosedExportPeriod(dateTo, settings?.lock_date ?? null);

    const sites = await listAccountingExportSites(
      this.prisma,
      tenantId,
      dto.legalEntityId,
      dateFrom,
      dateTo,
    );
    await assertCompleteAccountingExportScope(
      this.prisma,
      tenantId,
      currentUser.id,
      sites,
    );

    const profile = await this.prisma.legalEntityAccountingProfile.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: dto.legalEntityId,
      },
    });
    if (!profile) {
      throw new UnprocessableEntityException({
        code: 'EXPORT_PROFILE_NOT_READY',
        message: 'Accounting export profile is not configured.',
      });
    }

    const candidates = await loadAccountingExportCandidates(
      this.prisma,
      tenantId,
      dto.legalEntityId,
      dateFrom,
      dateTo,
    );

    const overlaps = await this.findOverlappingRuns(
      tenantId,
      dto.legalEntityId,
      dateFrom,
      dateTo,
    );

    return {
      dateFrom,
      dateTo,
      profile,
      sites,
      candidates,
      overlaps,
    };
  }

  private async findOverlappingRuns(
    tenantId: string,
    legalEntityId: string,
    dateFrom: Date,
    dateTo: Date,
  ) {
    const runs = await this.prisma.accountingExport.findMany({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
      orderBy: { createdAt: 'desc' },
    });

    return runs
      .filter((run) =>
        rangesOverlap(dateFrom, dateTo, run.date_from, run.date_to),
      )
      .map((run) => ({
        id: run.id,
        dateFrom: run.date_from.toISOString().slice(0, 10),
        dateTo: run.date_to.toISOString().slice(0, 10),
        createdAt: run.createdAt.toISOString(),
        fileSha256: run.file_sha256,
        documentCount: run.document_count,
      }));
  }

  private async loadAuthorizedExport(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    assertTenantAdmin(this.tenantContext);
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const exportRun = await this.prisma.accountingExport.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!exportRun) {
      throw new NotFoundException('Accounting export not found');
    }

    const siteIds = Array.isArray(exportRun.site_ids)
      ? (exportRun.site_ids as string[])
      : [];
    const sites = await this.prisma.site.findMany({
      where: { tenant_id: tenantId, id: { in: siteIds } },
      select: { id: true, code: true, name: true, is_active: true },
    });

    await assertCompleteAccountingExportScope(
      this.prisma,
      tenantId,
      currentUser.id,
      sites.map((site) => ({
        id: site.id,
        code: site.code,
        name: site.name,
        isActive: site.is_active,
      })),
    );

    return exportRun;
  }

  private serializeCreatedExport(
    exportRun: {
      id: string;
      legal_entity_id: string;
      date_from: Date;
      date_to: Date;
      file_sha256: string;
      document_count: number;
      row_count: number;
      createdAt: Date;
    },
    filename?: string,
  ) {
    const resolvedFilename =
      filename ??
      buildAccountingExportFilename({
        legalEntityId: exportRun.legal_entity_id,
        dateFrom: exportRun.date_from.toISOString().slice(0, 10),
        dateTo: exportRun.date_to.toISOString().slice(0, 10),
        runId: exportRun.id,
      });

    return {
      id: exportRun.id,
      filename: resolvedFilename,
      sha256: exportRun.file_sha256,
      documentCount: exportRun.document_count,
      rowCount: exportRun.row_count,
      createdAt: exportRun.createdAt.toISOString(),
    };
  }

  private serializeSummary(exportRun: {
    id: string;
    legal_entity_id: string;
    date_from: Date;
    date_to: Date;
    file_sha256: string;
    document_count: number;
    row_count: number;
    byte_length: number;
    createdAt: Date;
    created_by_user_id: string | null;
  }) {
    return {
      id: exportRun.id,
      legalEntityId: exportRun.legal_entity_id,
      dateFrom: exportRun.date_from.toISOString().slice(0, 10),
      dateTo: exportRun.date_to.toISOString().slice(0, 10),
      filename: buildAccountingExportFilename({
        legalEntityId: exportRun.legal_entity_id,
        dateFrom: exportRun.date_from.toISOString().slice(0, 10),
        dateTo: exportRun.date_to.toISOString().slice(0, 10),
        runId: exportRun.id,
      }),
      sha256: exportRun.file_sha256,
      documentCount: exportRun.document_count,
      rowCount: exportRun.row_count,
      byteLength: exportRun.byte_length,
      createdAt: exportRun.createdAt.toISOString(),
      createdByUserId: exportRun.created_by_user_id,
    };
  }
}

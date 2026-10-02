import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditActorType,
  AuditLogAction,
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../site/site.authorization.js';
import {
  IMPORT_ERROR_CODES,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROW_COUNT,
  IMPORT_SOURCE,
} from './import.constants.js';
import { parseCsvFile, rowToRecord, serializeCsv } from './csv-parse.util.js';
import type {
  DryRunRowResult,
  ImportJobOptions,
  ImportJobTotals,
} from './import.types.js';
import {
  customerNameKey,
  normalizeCustomerRow,
  planCustomerDryRunRow,
} from './customer-import.logic.js';
import {
  normalizeVehicleRow,
  planVehicleDryRunRow,
} from './vehicle-import.logic.js';
import { buildTemplateCsv, getImportTemplate } from './import.templates.js';
import {
  buildImportAuditDiff,
  pickCustomerAuditSnapshot,
  pickVehicleAuditSnapshot,
} from './import-audit.util.js';

class ApplyRowStaleError extends Error {
  constructor() {
    super('Import row plan is stale');
    this.name = 'ApplyRowStaleError';
  }
}

function resolveImportExternalId(
  payload: Record<string, unknown>,
  rowExternalId: string | null,
): string {
  const raw = payload.external_id ?? rowExternalId ?? '';
  if (typeof raw === 'string') {
    return raw;
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw);
  }
  return '';
}

@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async createDryRunFromUpload(params: {
    file: Express.Multer.File;
    entityType: ImportEntityType;
    sourceSystem: string;
    mappingJson: Record<string, string>;
    optionsJson: ImportJobOptions;
  }) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    if (!params.file?.buffer) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.EMPTY_FILE,
        message: 'CSV file is required',
      });
    }
    if (params.file.size > IMPORT_MAX_FILE_BYTES) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.FILE_TOO_LARGE,
        message: `CSV file exceeds ${IMPORT_MAX_FILE_BYTES} bytes`,
      });
    }

    const parsed = parseCsvFile(params.file.buffer);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.EMPTY_FILE,
        message: 'CSV file has no data rows',
      });
    }
    if (parsed.rows.length > IMPORT_MAX_ROW_COUNT) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.ROW_LIMIT_EXCEEDED,
        message: `CSV exceeds ${IMPORT_MAX_ROW_COUNT} rows`,
      });
    }

    const options = this.normalizeOptions(params.optionsJson);
    const dryRunRows = await this.runDryRun(
      tenantId,
      params.entityType,
      params.sourceSystem,
      params.mappingJson,
      options,
      parsed,
    );
    const totals = this.computeTotals(dryRunRows);

    const job = await this.prisma.importJob.create({
      data: {
        tenant_id: tenantId,
        entity_type: params.entityType,
        source_system: params.sourceSystem,
        file_name: params.file.originalname ?? 'import.csv',
        file_sha256: parsed.sha256,
        status: ImportJobStatus.DRY_RUN_DONE,
        mapping_json: params.mappingJson,
        options_json: options,
        totals_json: totals,
        created_by: currentUser.id,
        rows: {
          create: dryRunRows.map((row) => ({
            row_no: row.row_no,
            external_id: row.external_id,
            action: row.action,
            entity_id: row.entity_id,
            errors_json:
              row.errors.length > 0
                ? (row.errors as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            warnings_json:
              row.warnings.length > 0
                ? (row.warnings as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            normalized_json:
              row.normalized === null
                ? Prisma.JsonNull
                : (row.normalized as Prisma.InputJsonValue),
          })),
        },
      },
    });

    await this.writeImportJobAudit(tenantId, currentUser.id, job.id, 'created');

    return this.serializeJob(job, totals);
  }

  async getJob(jobId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
    if (!job) {
      throw new NotFoundException({
        code: IMPORT_ERROR_CODES.JOB_NOT_FOUND,
        message: 'Import job not found',
      });
    }
    return this.serializeJob(job, job.totals_json as ImportJobTotals);
  }

  async listJobRows(
    jobId: string,
    query: {
      page?: number;
      limit?: number;
      action?: ImportRowAction;
      hasErrors?: boolean;
    },
  ) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await this.getJob(jobId);

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.ImportJobRowWhereInput = {
      tenant_id: tenantId,
      import_job_id: jobId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.hasErrors === true ? { action: ImportRowAction.ERROR } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.importJobRow.findMany({
        where,
        orderBy: { row_no: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.importJobRow.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.serializeRow(row)),
      meta: { total, page, limit },
    };
  }

  async downloadErrorRowsCsv(jobId: string): Promise<string> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const job = await this.prisma.importJob.findFirst({
      where: { tenant_id: tenantId, id: jobId },
    });
    if (!job) {
      throw new NotFoundException({
        code: IMPORT_ERROR_CODES.JOB_NOT_FOUND,
        message: 'Import job not found',
      });
    }

    const rows = await this.prisma.importJobRow.findMany({
      where: {
        tenant_id: tenantId,
        import_job_id: jobId,
        action: ImportRowAction.ERROR,
      },
      orderBy: { row_no: 'asc' },
    });

    const headers = ['row_no', 'external_id', 'errors'];
    const data = rows.map((row) => [
      String(row.row_no),
      row.external_id ?? '',
      JSON.stringify(row.errors_json ?? []),
    ]);
    return serializeCsv(headers, data, ';');
  }

  async applyJob(jobId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const lock = await this.prisma.importJob.updateMany({
      where: {
        tenant_id: tenantId,
        id: jobId,
        status: ImportJobStatus.DRY_RUN_DONE,
      },
      data: { status: ImportJobStatus.APPLYING },
    });

    if (lock.count === 0) {
      const existing = await this.prisma.importJob.findFirst({
        where: { tenant_id: tenantId, id: jobId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: IMPORT_ERROR_CODES.JOB_NOT_FOUND,
          message: 'Import job not found',
        });
      }
      if (existing.status === ImportJobStatus.APPLYING) {
        throw new ConflictException({
          code: IMPORT_ERROR_CODES.APPLY_IN_PROGRESS,
          message: 'Import job is already being applied',
        });
      }
      if (existing.status === ImportJobStatus.APPLIED) {
        throw new ConflictException({
          code: IMPORT_ERROR_CODES.JOB_ALREADY_APPLIED,
          message: 'Import job was already applied',
        });
      }
      throw new ConflictException({
        code: IMPORT_ERROR_CODES.JOB_STALE,
        message: 'Import job cannot be applied in its current status',
      });
    }

    const job = await this.prisma.importJob.findFirstOrThrow({
      where: { tenant_id: tenantId, id: jobId },
    });

    const rows = await this.prisma.importJobRow.findMany({
      where: { tenant_id: tenantId, import_job_id: jobId },
      orderBy: { row_no: 'asc' },
    });

    const totals: ImportJobTotals = {
      rows: rows.length,
      create: 0,
      update: 0,
      skip: 0,
      error: 0,
    };

    try {
      for (const row of rows) {
        if (row.action === ImportRowAction.ERROR) {
          totals.error += 1;
          continue;
        }
        if (row.action === ImportRowAction.SKIP) {
          totals.skip += 1;
          continue;
        }

        try {
          await this.prisma.$transaction(async (tx) => {
            await this.assertApplyRowIsFresh(
              tx,
              tenantId,
              job.entity_type,
              job.source_system,
              row,
            );
            if (job.entity_type === ImportEntityType.CUSTOMER) {
              await this.applyCustomerRow(
                tx,
                tenantId,
                job,
                row,
                currentUser.id,
              );
            } else {
              await this.applyVehicleRow(
                tx,
                tenantId,
                job,
                row,
                currentUser.id,
              );
            }
          });
          if (row.action === ImportRowAction.CREATE) {
            totals.create += 1;
          } else if (row.action === ImportRowAction.UPDATE) {
            totals.update += 1;
          }
        } catch (error) {
          const cause =
            error instanceof Prisma.PrismaClientKnownRequestError
              ? error.code
              : error instanceof Error
                ? error.name
                : 'unknown';
          this.logger.warn(
            `Import apply row failed jobId=${jobId} rowNo=${row.row_no} cause=${cause}`,
          );
          totals.error += 1;
          const staleMessage =
            error instanceof ApplyRowStaleError
              ? error.message
              : 'Row failed during apply';
          const staleCode =
            error instanceof ApplyRowStaleError
              ? IMPORT_ERROR_CODES.ROW_STALE
              : 'IMPORT_APPLY_FAILED';
          await this.prisma.importJobRow.update({
            where: {
              tenant_id_import_job_id_row_no: {
                tenant_id: tenantId,
                import_job_id: jobId,
                row_no: row.row_no,
              },
            },
            data: {
              action: ImportRowAction.ERROR,
              errors_json: [
                {
                  code: staleCode,
                  message: staleMessage,
                },
              ],
            },
          });
        }
      }

      const updated = await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: ImportJobStatus.APPLIED,
          appliedAt: new Date(),
          totals_json: totals,
        },
      });

      await this.writeImportJobAudit(
        tenantId,
        currentUser.id,
        jobId,
        'applied',
        totals,
      );

      return this.serializeJob(updated, totals);
    } catch (error) {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: { status: ImportJobStatus.FAILED, totals_json: totals },
      });
      throw error;
    }
  }

  getTemplate(entityType: ImportEntityType) {
    assertTenantAdmin(this.tenantContext);
    const template = getImportTemplate(entityType);
    return {
      entity_type: template.entity_type,
      fields: template.fields,
      csv: buildTemplateCsv(entityType),
    };
  }

  private normalizeOptions(options: ImportJobOptions): ImportJobOptions {
    return {
      update_existing: options.update_existing === true,
      fill_empty_only: options.fill_empty_only === true,
      allow_missing_vin: options.allow_missing_vin === true,
      invalid_vat_as_error: options.invalid_vat_as_error === true,
    };
  }

  private async runDryRun(
    tenantId: string,
    entityType: ImportEntityType,
    sourceSystem: string,
    mapping: Record<string, string>,
    options: ImportJobOptions,
    parsed: ReturnType<typeof parseCsvFile>,
  ): Promise<DryRunRowResult[]> {
    if (entityType === ImportEntityType.CUSTOMER) {
      return this.runCustomerDryRun(
        tenantId,
        sourceSystem,
        mapping,
        options,
        parsed,
      );
    }
    return this.runVehicleDryRun(
      tenantId,
      sourceSystem,
      mapping,
      options,
      parsed,
    );
  }

  private async runCustomerDryRun(
    tenantId: string,
    sourceSystem: string,
    mapping: Record<string, string>,
    options: ImportJobOptions,
    parsed: ReturnType<typeof parseCsvFile>,
  ): Promise<DryRunRowResult[]> {
    const mappings = await this.prisma.externalIdMapping.findMany({
      where: {
        tenant_id: tenantId,
        entity_type: ImportEntityType.CUSTOMER,
        source_system: sourceSystem,
      },
    });
    const mappingByExternalId = new Map(
      mappings.map((row) => [row.external_id, row.entity_id]),
    );

    const customers = await this.prisma.customer.findMany({
      where: { tenant_id: tenantId },
    });
    const customerByEmail = new Map<
      string,
      { id: string; record: Record<string, unknown> }
    >();
    const customerById = new Map<string, Record<string, unknown>>();
    const duplicateNameKeys = new Set<string>();

    for (const customer of customers) {
      const snapshot = pickCustomerAuditSnapshot(customer);
      customerById.set(customer.id, snapshot);
      if (customer.email) {
        customerByEmail.set(customer.email.toLowerCase(), {
          id: customer.id,
          record: snapshot,
        });
      }
      const key =
        customer.type === 'COMPANY' && customer.company_name
          ? `company:${customer.company_name.trim().toLowerCase()}`
          : `person:${customer.first_name.trim().toLowerCase()}|${customer.last_name.trim().toLowerCase()}`;
      duplicateNameKeys.add(key);
    }

    const externalIdSeenInFile = new Map<string, number>();
    const emailSeenInFile = new Map<string, number>();
    const results: DryRunRowResult[] = [];
    for (let index = 0; index < parsed.rows.length; index += 1) {
      const rowNo = index + 1;
      const record = rowToRecord(parsed.headers, parsed.rows[index]);
      const normalized = normalizeCustomerRow(record, mapping, options);
      if (!normalized.row) {
        results.push({
          row_no: rowNo,
          external_id: record[mapping.external_id ?? ''] ?? null,
          action: ImportRowAction.ERROR,
          entity_id: null,
          errors: normalized.issues,
          warnings: normalized.warnings,
          normalized: null,
        });
        continue;
      }
      const planned = planCustomerDryRunRow(
        rowNo,
        normalized.row,
        {
          mappingByExternalId,
          customerByEmail,
          customerById,
          duplicateNameKeys,
          externalIdSeenInFile,
          emailSeenInFile,
        },
        options,
        normalized.warnings,
      );
      if (planned.action === ImportRowAction.CREATE) {
        duplicateNameKeys.add(customerNameKey(normalized.row));
      }
      results.push(planned);
    }
    return results;
  }

  private async runVehicleDryRun(
    tenantId: string,
    sourceSystem: string,
    mapping: Record<string, string>,
    options: ImportJobOptions,
    parsed: ReturnType<typeof parseCsvFile>,
  ): Promise<DryRunRowResult[]> {
    const mappings = await this.prisma.externalIdMapping.findMany({
      where: { tenant_id: tenantId, source_system: sourceSystem },
    });
    const vehicleMappings = mappings.filter(
      (row) => row.entity_type === ImportEntityType.VEHICLE,
    );
    const customerMappings = mappings.filter(
      (row) => row.entity_type === ImportEntityType.CUSTOMER,
    );

    const mappingByExternalId = new Map(
      vehicleMappings.map((row) => [row.external_id, row.entity_id]),
    );
    const customerExternalToEntityId = new Map(
      customerMappings.map((row) => [row.external_id, row.entity_id]),
    );

    const vehicles = await this.prisma.vehicle.findMany({
      where: { tenant_id: tenantId },
    });
    const vehicleByVin = new Map<string, string>();
    const vehicleByPlate = new Map<string, string>();
    const vehicleById = new Map<string, Record<string, unknown>>();
    for (const vehicle of vehicles) {
      vehicleById.set(vehicle.id, pickVehicleAuditSnapshot(vehicle));
      if (vehicle.vin) {
        vehicleByVin.set(vehicle.vin.toUpperCase(), vehicle.id);
      }
      if (vehicle.plate) {
        vehicleByPlate.set(
          vehicle.plate.toUpperCase().replace(/\s+/g, ''),
          vehicle.id,
        );
      }
    }

    const context = {
      mappingByExternalId,
      vehicleByVin,
      vehicleByPlate,
      vehicleById,
      customerExternalToEntityId,
      vinSeenInFile: new Map<string, number>(),
      externalIdSeenInFile: new Map<string, number>(),
    };

    const results: DryRunRowResult[] = [];
    for (let index = 0; index < parsed.rows.length; index += 1) {
      const rowNo = index + 1;
      const record = rowToRecord(parsed.headers, parsed.rows[index]);
      const normalized = normalizeVehicleRow(record, mapping, options);
      if (!normalized.row) {
        results.push({
          row_no: rowNo,
          external_id: record[mapping.external_id ?? ''] ?? null,
          action: ImportRowAction.ERROR,
          entity_id: null,
          errors: normalized.issues,
          warnings: normalized.warnings,
          normalized: null,
        });
        continue;
      }
      results.push(
        planVehicleDryRunRow(
          rowNo,
          normalized.row,
          context,
          options,
          normalized.warnings,
        ),
      );
    }
    return results;
  }

  private async assertApplyRowIsFresh(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entityType: ImportEntityType,
    sourceSystem: string,
    row: {
      action: ImportRowAction;
      entity_id: string | null;
      external_id: string | null;
      normalized_json: Prisma.JsonValue;
    },
  ): Promise<void> {
    if (
      row.action !== ImportRowAction.CREATE &&
      row.action !== ImportRowAction.UPDATE
    ) {
      return;
    }

    const payload = row.normalized_json as Record<string, unknown>;
    const externalId = resolveImportExternalId(payload, row.external_id);

    if (row.action === ImportRowAction.CREATE) {
      const mapping = await tx.externalIdMapping.findFirst({
        where: {
          tenant_id: tenantId,
          entity_type: entityType,
          source_system: sourceSystem,
          external_id: externalId,
        },
      });
      if (mapping) {
        throw new ApplyRowStaleError();
      }
      return;
    }

    if (!row.entity_id) {
      throw new ApplyRowStaleError();
    }

    if (entityType === ImportEntityType.CUSTOMER) {
      const customer = await tx.customer.findFirst({
        where: { tenant_id: tenantId, id: row.entity_id },
      });
      if (!customer) {
        throw new ApplyRowStaleError();
      }
      return;
    }

    const vehicle = await tx.vehicle.findFirst({
      where: { tenant_id: tenantId, id: row.entity_id },
    });
    if (!vehicle) {
      throw new ApplyRowStaleError();
    }
  }

  private async applyCustomerRow(
    tx: Prisma.TransactionClient,
    tenantId: string,
    job: {
      id: string;
      source_system: string;
      options_json: Prisma.JsonValue;
    },
    row: {
      row_no: number;
      action: ImportRowAction;
      entity_id: string | null;
      external_id: string | null;
      normalized_json: Prisma.JsonValue;
    },
    actorUserId: string,
  ) {
    const payload = row.normalized_json as Record<string, unknown>;
    const externalId = resolveImportExternalId(payload, row.external_id);
    delete payload.external_id;

    if (row.action === ImportRowAction.CREATE) {
      const created = await tx.customer.create({
        data: {
          tenant_id: tenantId,
          type: payload.type as Prisma.CustomerCreateInput['type'],
          company_name: payload.company_name as string | null,
          first_name: String(payload.first_name),
          last_name: String(payload.last_name),
          email: payload.email as string | null,
          phone: payload.phone as string | null,
          vat_id: payload.vat_id as string | null,
          address_street: payload.address_street as string | null,
          address_zip: payload.address_zip as string | null,
          address_city: payload.address_city as string | null,
          address_country: (payload.address_country as string | null) ?? 'AT',
        },
      });
      await this.createExternalMapping(
        tx,
        tenantId,
        ImportEntityType.CUSTOMER,
        job.source_system,
        externalId,
        created.id,
        job.id,
      );
      await this.writeEntityAudit(
        tx,
        tenantId,
        actorUserId,
        job.id,
        'Customer',
        created.id,
        AuditLogAction.CREATE,
        null,
        pickCustomerAuditSnapshot(created),
      );
      return;
    }

    if (row.action === ImportRowAction.UPDATE && row.entity_id) {
      const before = await tx.customer.findFirst({
        where: { tenant_id: tenantId, id: row.entity_id },
      });
      if (!before) {
        throw new Error('Customer not found');
      }
      const updateData = this.buildCustomerUpdateData(
        before,
        payload,
        (job.options_json as ImportJobOptions) ?? {},
      );
      const after = await tx.customer.update({
        where: { id: row.entity_id },
        data: updateData,
      });
      await this.upsertExternalMapping(
        tx,
        tenantId,
        ImportEntityType.CUSTOMER,
        job.source_system,
        externalId,
        after.id,
        job.id,
      );
      await this.writeEntityAudit(
        tx,
        tenantId,
        actorUserId,
        job.id,
        'Customer',
        after.id,
        AuditLogAction.UPDATE,
        pickCustomerAuditSnapshot(before),
        pickCustomerAuditSnapshot(after),
      );
    }
  }

  private buildCustomerUpdateData(
    existing: {
      company_name: string | null;
      first_name: string;
      last_name: string;
      email: string | null;
      phone: string | null;
      vat_id: string | null;
      address_street: string | null;
      address_zip: string | null;
      address_city: string | null;
      address_country: string | null;
      type: string;
    },
    payload: Record<string, unknown>,
    options: ImportJobOptions,
  ) {
    const data: Prisma.CustomerUpdateInput = {};
    const assign = (key: keyof typeof existing, value: unknown) => {
      if (options.fill_empty_only) {
        const current = existing[key];
        if (
          current !== null &&
          current !== undefined &&
          String(current).trim() !== ''
        ) {
          return;
        }
      }
      if (value === null || value === undefined || value === '') {
        return;
      }
      (data as Record<string, unknown>)[key] = value;
    };
    assign('type', payload.type);
    assign('company_name', payload.company_name);
    assign('first_name', payload.first_name);
    assign('last_name', payload.last_name);
    assign('email', payload.email);
    assign('phone', payload.phone);
    assign('vat_id', payload.vat_id);
    assign('address_street', payload.address_street);
    assign('address_zip', payload.address_zip);
    assign('address_city', payload.address_city);
    assign('address_country', payload.address_country);
    return data;
  }

  private buildVehicleUpdateData(
    existing: {
      make: string;
      model: string;
      year: number;
      vin: string | null;
      plate: string | null;
      mileage: number | null;
      color: string | null;
      key_number: string | null;
      customer_id: string | null;
    },
    payload: Record<string, unknown>,
    options: ImportJobOptions,
  ) {
    const data: Prisma.VehicleUncheckedUpdateInput = {};
    const assign = (key: keyof typeof existing, value: unknown) => {
      if (options.fill_empty_only) {
        const current = existing[key];
        if (
          current !== null &&
          current !== undefined &&
          String(current).trim() !== ''
        ) {
          return;
        }
      }
      if (value === null || value === undefined || value === '') {
        return;
      }
      (data as Record<string, unknown>)[key] = value;
    };

    assign('make', payload.make);
    assign('model', payload.model);
    assign('year', payload.year);
    assign('vin', payload.vin);
    assign('plate', payload.plate);
    assign('mileage', payload.mileage);
    assign('color', payload.color);
    assign('key_number', payload.key_number);
    if (payload.owner_external_id_provided === true) {
      if (
        payload.customer_id === null ||
        payload.customer_id === undefined ||
        payload.customer_id === ''
      ) {
        data.customer_id = null;
      } else {
        assign('customer_id', payload.customer_id);
      }
    }
    return data;
  }

  private async applyVehicleRow(
    tx: Prisma.TransactionClient,
    tenantId: string,
    job: { id: string; source_system: string; options_json?: Prisma.JsonValue },
    row: {
      row_no: number;
      action: ImportRowAction;
      entity_id: string | null;
      external_id: string | null;
      normalized_json: Prisma.JsonValue;
    },
    actorUserId: string,
  ) {
    const payload = row.normalized_json as Record<string, unknown>;
    const externalId = resolveImportExternalId(payload, row.external_id);
    delete payload.external_id;
    delete payload.owner_external_id_provided;

    if (row.action === ImportRowAction.CREATE) {
      const created = await tx.vehicle.create({
        data: {
          tenant_id: tenantId,
          make: String(payload.make),
          model: String(payload.model),
          year: Number(payload.year),
          vin: payload.vin as string | null,
          plate: payload.plate as string | null,
          mileage: payload.mileage as number | null,
          color: payload.color as string | null,
          key_number: payload.key_number as string | null,
          customer_id: payload.customer_id as string | null,
        },
      });
      await this.createExternalMapping(
        tx,
        tenantId,
        ImportEntityType.VEHICLE,
        job.source_system,
        externalId,
        created.id,
        job.id,
      );
      await this.writeEntityAudit(
        tx,
        tenantId,
        actorUserId,
        job.id,
        'Vehicle',
        created.id,
        AuditLogAction.CREATE,
        null,
        pickVehicleAuditSnapshot(created),
      );
      return;
    }

    if (row.action === ImportRowAction.UPDATE && row.entity_id) {
      const before = await tx.vehicle.findFirst({
        where: { tenant_id: tenantId, id: row.entity_id },
      });
      if (!before) {
        throw new ApplyRowStaleError();
      }
      const updateData = this.buildVehicleUpdateData(
        before,
        payload,
        (job.options_json as ImportJobOptions) ?? {},
      );
      const after = await tx.vehicle.update({
        where: { id: row.entity_id },
        data: updateData,
      });
      await this.upsertExternalMapping(
        tx,
        tenantId,
        ImportEntityType.VEHICLE,
        job.source_system,
        externalId,
        after.id,
        job.id,
      );
      await this.writeEntityAudit(
        tx,
        tenantId,
        actorUserId,
        job.id,
        'Vehicle',
        after.id,
        AuditLogAction.UPDATE,
        pickVehicleAuditSnapshot(before),
        pickVehicleAuditSnapshot(after),
      );
    }
  }

  private async createExternalMapping(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entityType: ImportEntityType,
    sourceSystem: string,
    externalId: string,
    entityId: string,
    jobId: string,
  ) {
    try {
      await tx.externalIdMapping.create({
        data: {
          tenant_id: tenantId,
          entity_type: entityType,
          source_system: sourceSystem,
          external_id: externalId,
          entity_id: entityId,
          first_seen_import_job_id: jobId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ApplyRowStaleError();
      }
      throw error;
    }
  }

  private async upsertExternalMapping(
    tx: Prisma.TransactionClient,
    tenantId: string,
    entityType: ImportEntityType,
    sourceSystem: string,
    externalId: string,
    entityId: string,
    jobId: string,
  ) {
    await tx.externalIdMapping.upsert({
      where: {
        tenant_id_entity_type_source_system_external_id: {
          tenant_id: tenantId,
          entity_type: entityType,
          source_system: sourceSystem,
          external_id: externalId,
        },
      },
      create: {
        tenant_id: tenantId,
        entity_type: entityType,
        source_system: sourceSystem,
        external_id: externalId,
        entity_id: entityId,
        first_seen_import_job_id: jobId,
      },
      update: { entity_id: entityId },
    });
  }

  private async writeEntityAudit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorUserId: string,
    importJobId: string,
    entityType: string,
    entityId: string,
    action: AuditLogAction,
    before: unknown,
    after: unknown,
  ) {
    const authUser = this.tenantContext.getAuthenticatedUser();
    const diff = buildImportAuditDiff(before, after);
    await tx.auditLog.create({
      data: {
        tenant_id: tenantId,
        entity_type: entityType,
        entity_id: entityId,
        action,
        actor_user_id: actorUserId,
        actor_email: authUser?.email ?? null,
        actor_role: authUser?.role ?? null,
        actor_type: AuditActorType.USER,
        source: IMPORT_SOURCE,
        before: before ? (before as Prisma.InputJsonValue) : Prisma.JsonNull,
        after: {
          ...(after && typeof after === 'object'
            ? (after as Record<string, unknown>)
            : {}),
          importJobId,
        },
        diff: (diff as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
  }

  private async writeImportJobAudit(
    tenantId: string,
    actorUserId: string,
    jobId: string,
    event: 'created' | 'applied',
    totals?: ImportJobTotals,
  ) {
    const authUser = this.tenantContext.getAuthenticatedUser();
    await this.prisma.auditLog.create({
      data: {
        tenant_id: tenantId,
        entity_type: 'ImportJob',
        entity_id: jobId,
        action:
          event === 'created' ? AuditLogAction.CREATE : AuditLogAction.UPDATE,
        actor_user_id: actorUserId,
        actor_email: authUser?.email ?? null,
        actor_role: authUser?.role ?? null,
        actor_type: AuditActorType.USER,
        source: IMPORT_SOURCE,
        after: {
          event: `import_job.${event}`,
          importJobId: jobId,
          totals,
        },
      },
    });
  }

  private computeTotals(
    rows: Array<{ action: ImportRowAction }>,
  ): ImportJobTotals {
    return rows.reduce(
      (acc, row) => {
        acc.rows += 1;
        if (row.action === ImportRowAction.CREATE) acc.create += 1;
        if (row.action === ImportRowAction.UPDATE) acc.update += 1;
        if (row.action === ImportRowAction.SKIP) acc.skip += 1;
        if (row.action === ImportRowAction.ERROR) acc.error += 1;
        return acc;
      },
      { rows: 0, create: 0, update: 0, skip: 0, error: 0 },
    );
  }

  private serializeJob(
    job: {
      id: string;
      entity_type: ImportEntityType;
      source_system: string;
      file_name: string;
      file_sha256: string;
      status: ImportJobStatus;
      mapping_json: Prisma.JsonValue;
      options_json: Prisma.JsonValue;
      totals_json: Prisma.JsonValue;
      created_by: string | null;
      createdAt: Date;
      appliedAt: Date | null;
    },
    totals: ImportJobTotals,
  ) {
    return {
      id: job.id,
      entity_type: job.entity_type,
      source_system: job.source_system,
      file_name: job.file_name,
      file_sha256: job.file_sha256,
      status: job.status,
      mapping: job.mapping_json,
      options: job.options_json,
      totals,
      created_by: job.created_by,
      created_at: job.createdAt.toISOString(),
      applied_at: job.appliedAt?.toISOString() ?? null,
    };
  }

  private serializeRow(row: {
    row_no: number;
    external_id: string | null;
    action: ImportRowAction;
    entity_id: string | null;
    errors_json: Prisma.JsonValue;
    warnings_json: Prisma.JsonValue;
    normalized_json: Prisma.JsonValue;
  }) {
    return {
      row_no: row.row_no,
      external_id: row.external_id,
      action: row.action,
      entity_id: row.entity_id,
      errors: row.errors_json ?? [],
      warnings: row.warnings_json ?? [],
      normalized: row.normalized_json,
    };
  }
}

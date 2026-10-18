import { createHash } from 'node:crypto';
import {
  AuditActorType,
  AuditLogAction,
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import {
  IMPORT_ERROR_CODES,
  IMPORT_MAX_FILE_BYTES,
} from './import.constants.js';
import {
  ACTOR_AUTH_UID,
  ACTOR_DB_ID,
  ACTOR_EMAIL,
  CREATED_AT,
  JOB_ID,
  SOURCE_SYSTEM,
  TENANT_ID,
  TRACE_ID,
  arrangeApply,
  csvUpload,
  dryRunParams,
  importJobRecord,
  jobRowRecord,
  setupImportHarness,
} from './import.service.spec.support.js';

const CUSTOMER_CSV = 'Kunden-Nr;Vorname;Nachname\nK-1;Anna;Berger\n';
const CUSTOMER_MAPPING = {
  external_id: 'Kunden-Nr',
  first_name: 'Vorname',
  last_name: 'Nachname',
};
const DRY_RUN_CREATE_TOTALS = {
  rows: 1,
  create: 1,
  update: 0,
  skip: 0,
  error: 0,
  flagged_jumps: 0,
};

describe('ImportService job lifecycle — createDryRunFromUpload persisted job', () => {
  const h = setupImportHarness();

  describe('createDryRunFromUpload persisted job', () => {
    it('stores tenant, actor, file fingerprint, mapping and status on the job', async () => {
      const file = csvUpload(CUSTOMER_CSV, 'kunden.csv');

      await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          file,
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      const { data } = h.prisma.importJob.create.mock.calls[0][0];
      expect(data).toMatchObject({
        tenant_id: TENANT_ID,
        entity_type: ImportEntityType.CUSTOMER,
        source_system: SOURCE_SYSTEM,
        file_name: 'kunden.csv',
        file_sha256: createHash('sha256').update(file.buffer).digest('hex'),
        status: ImportJobStatus.DRY_RUN_DONE,
        mapping_json: CUSTOMER_MAPPING,
        created_by: ACTOR_DB_ID,
        totals_json: DRY_RUN_CREATE_TOTALS,
      });
    });

    it('defaults the file name when the upload has no original name', async () => {
      await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(h.prisma.importJob.create.mock.calls[0][0].data.file_name).toBe(
        'import.csv',
      );
    });

    it('normalizes options before persisting them and drops invalid values', async () => {
      await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          mappingJson: CUSTOMER_MAPPING,
          optionsJson: {
            update_existing: 'yes' as unknown as boolean,
            fill_empty_only: true,
            accepted_row_numbers: [3, 'x', '4'] as unknown as number[],
            price_jump_threshold_percent: Number.NaN,
            vendor_id: '   ',
          },
        }),
      );

      expect(
        h.prisma.importJob.create.mock.calls[0][0].data.options_json,
      ).toEqual({
        update_existing: false,
        fill_empty_only: true,
        allow_missing_vin: false,
        invalid_vat_as_error: false,
        create_new_catalog_items: false,
        accept_all_price_jumps: false,
        accepted_row_numbers: [3, 4],
      });
    });

    it('stores each dry-run row with JSON columns that are null when empty', async () => {
      const text =
        'Kunden-Nr;Vorname;Nachname\n;Anna;Berger\nK-2;Bruno;Huber\n';

      await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, text, {
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      const rows = h.prisma.importJob.create.mock.calls[0][0].data.rows.create;
      expect(rows[0]).toMatchObject({
        row_no: 1,
        external_id: '',
        action: ImportRowAction.ERROR,
        entity_id: null,
        errors_json: [
          {
            code: 'IMPORT_EXTERNAL_ID_REQUIRED',
            message: 'external_id is required',
            field: 'external_id',
          },
        ],
        warnings_json: Prisma.JsonNull,
        normalized_json: Prisma.JsonNull,
      });
      expect(rows[1]).toMatchObject({
        row_no: 2,
        external_id: 'K-2',
        action: ImportRowAction.CREATE,
        entity_id: null,
        errors_json: Prisma.JsonNull,
        warnings_json: Prisma.JsonNull,
      });
      expect(rows[1].normalized_json).toMatchObject({
        external_id: 'K-2',
        first_name: 'Bruno',
        last_name: 'Huber',
      });
    });

    it('writes one created audit entry for the job with the request actor', async () => {
      await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(h.prisma.auditLog.create).toHaveBeenCalledTimes(1);
      expect(h.prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'ImportJob',
          entity_id: JOB_ID,
          action: AuditLogAction.CREATE,
          actor_user_id: ACTOR_DB_ID,
          actor_email: ACTOR_EMAIL,
          actor_role: 'ADMIN',
          actor_type: AuditActorType.USER,
          source: 'import',
          // The created entry records no totals; only the applied entry does.
          after: { event: 'import_job.created', importJobId: JOB_ID },
        },
      });
    });

    it('returns the serialized job with dry-run totals and no applied timestamp', async () => {
      const result = await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          file: csvUpload(CUSTOMER_CSV, 'kunden.csv'),
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(result).toEqual({
        id: JOB_ID,
        entity_type: ImportEntityType.CUSTOMER,
        source_system: SOURCE_SYSTEM,
        file_name: 'kunden.csv',
        file_sha256: expect.any(String),
        status: ImportJobStatus.DRY_RUN_DONE,
        mapping: CUSTOMER_MAPPING,
        options: expect.objectContaining({ update_existing: false }),
        totals: DRY_RUN_CREATE_TOTALS,
        created_by: ACTOR_DB_ID,
        created_at: CREATED_AT.toISOString(),
        applied_at: null,
      });
    });
  });

});

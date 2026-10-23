import {
  AuditLogAction,
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import {
  ACTOR_DB_ID,
  ACTOR_EMAIL,
  JOB_ID,
  SOURCE_SYSTEM,
  TENANT_ID,
  arrangeApply,
  dryRunParams,
  importJobRecord,
  jobRowRecord,
  setupImportHarness,
} from './import.service.spec.support.js';

const HEADER = [
  'Kunden-Nr',
  'Typ',
  'Firmenname',
  'Vorname',
  'Nachname',
  'E-Mail',
  'Telefon',
  'UID',
  'Straße',
  'PLZ',
  'Ort',
  'Land',
].join(';');

const MAPPING = {
  external_id: 'Kunden-Nr',
  type: 'Typ',
  company_name: 'Firmenname',
  first_name: 'Vorname',
  last_name: 'Nachname',
  email: 'E-Mail',
  phone: 'Telefon',
  vat_id: 'UID',
  address_street: 'Straße',
  address_zip: 'PLZ',
  address_city: 'Ort',
  address_country: 'Land',
};

const csvOf = (...lines: string[][]) =>
  [HEADER, ...lines.map((cells) => cells.join(';'))].join('\n') + '\n';

const EMPTY_ROW = Array.from({ length: 12 }, () => '');

function withCells(overrides: Record<number, string>): string[] {
  return EMPTY_ROW.map((cell, index) => overrides[index] ?? cell);
}

// Column indexes in HEADER order, to keep fixture rows readable.
const COL = {
  externalId: 0,
  type: 1,
  companyName: 2,
  firstName: 3,
  lastName: 4,
  email: 5,
  phone: 6,
  vatId: 7,
  street: 8,
  zip: 9,
  city: 10,
  country: 11,
};

function existingCustomer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cust-1',
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Anna',
    last_name: 'Berger',
    email: null,
    phone: null,
    vat_id: null,
    address_street: null,
    address_zip: null,
    address_city: null,
    address_country: null,
    ...overrides,
  };
}

describe('ImportService customer import (characterization)', () => {
  const h = setupImportHarness();

  function dryRunRows(text: string, optionsJson = {}) {
    return h.service
      .createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, text, {
          mappingJson: MAPPING,
          optionsJson,
        }),
      )
      .then(
        () => h.prisma.importJob.create.mock.calls.at(-1)![0].data.rows.create,
      );
  }

  describe('dry run', () => {
    it('plans new customers and normalizes type, names, email and country', async () => {
      const text = csvOf(
        withCells({
          [COL.externalId]: 'K-1',
          [COL.type]: 'Firma',
          [COL.companyName]: 'Autohaus Muster',
          [COL.email]: 'Info@Muster.AT',
          [COL.phone]: '+43 1',
          [COL.street]: 'Hauptstr. 1',
          [COL.zip]: '1010',
          [COL.city]: 'Wien',
          [COL.country]: 'AT',
        }),
        withCells({
          [COL.externalId]: 'K-2',
          [COL.type]: 'Privat',
          [COL.firstName]: 'Anna',
          [COL.lastName]: 'Berger',
        }),
      );

      const rows = await dryRunRows(text);

      expect(rows[0]).toMatchObject({
        row_no: 1,
        external_id: 'K-1',
        action: ImportRowAction.CREATE,
        normalized_json: {
          external_id: 'K-1',
          type: 'COMPANY',
          company_name: 'Autohaus Muster',
          first_name: 'Autohaus Muster',
          last_name: 'Autohaus Muster',
          email: 'info@muster.at',
          phone: '+43 1',
          vat_id: null,
          address_street: 'Hauptstr. 1',
          address_zip: '1010',
          address_city: 'Wien',
          address_country: 'AT',
        },
      });
      expect(rows[1]).toMatchObject({
        row_no: 2,
        external_id: 'K-2',
        action: ImportRowAction.CREATE,
        normalized_json: {
          external_id: 'K-2',
          type: 'PRIVATE',
          company_name: null,
          first_name: 'Anna',
          last_name: 'Berger',
          email: null,
          address_country: null,
        },
      });
    });

    it('fills missing names with a dash for private customers', async () => {
      const text = csvOf(withCells({ [COL.externalId]: 'K-3' }));

      const [row] = await dryRunRows(text);

      expect(row.normalized_json).toMatchObject({
        type: 'PRIVATE',
        first_name: '-',
        last_name: '-',
      });
    });

    it('rejects rows without an external id with IMPORT_EXTERNAL_ID_REQUIRED', async () => {
      const text = csvOf(
        withCells({
          [COL.type]: 'Privat',
          [COL.firstName]: 'Anna',
          [COL.lastName]: 'Berger',
        }),
      );

      const [row] = await dryRunRows(text);

      expect(row).toMatchObject({
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
        normalized_json: Prisma.JsonNull,
      });
    });

    it('flags a repeated external id in the file against the first row', async () => {
      const text = csvOf(
        withCells({
          [COL.externalId]: 'K-1',
          [COL.firstName]: 'Anna',
          [COL.lastName]: 'Berger',
        }),
        withCells({
          [COL.externalId]: 'K-1',
          [COL.firstName]: 'Bruno',
          [COL.lastName]: 'Huber',
        }),
      );

      const [first, second] = await dryRunRows(text);

      expect(first.action).toBe(ImportRowAction.CREATE);
      expect(second).toMatchObject({
        row_no: 2,
        external_id: 'K-1',
        action: ImportRowAction.ERROR,
        errors_json: [
          {
            code: IMPORT_ERROR_CODES.DUPLICATE_EXTERNAL_ID_IN_FILE,
            message: 'Duplicate external_id in file (first seen on row 1)',
            field: 'external_id',
          },
        ],
      });
    });

    it('flags a second new customer with the same email, case-insensitively', async () => {
      const text = csvOf(
        withCells({
          [COL.externalId]: 'K-1',
          [COL.email]: 'dup@x.at',
          [COL.firstName]: 'A',
          [COL.lastName]: 'B',
        }),
        withCells({
          [COL.externalId]: 'K-2',
          [COL.email]: 'DUP@x.at',
          [COL.firstName]: 'C',
          [COL.lastName]: 'D',
        }),
      );

      const [, second] = await dryRunRows(text);

      expect(second).toMatchObject({
        row_no: 2,
        action: ImportRowAction.ERROR,
        errors_json: [
          {
            code: IMPORT_ERROR_CODES.DUPLICATE_EMAIL_IN_FILE,
            message: 'Duplicate email in file (first seen on row 1)',
            field: 'email',
          },
        ],
      });
    });

    it('imports an invalid UID without it and a warning, unless invalid_vat_as_error is set', async () => {
      const text = csvOf(
        withCells({
          [COL.externalId]: 'K-1',
          [COL.vatId]: 'ATX123',
          [COL.country]: 'AT',
          [COL.firstName]: 'Anna',
          [COL.lastName]: 'Berger',
        }),
      );

      const [lenient] = await dryRunRows(text);
      expect(lenient).toMatchObject({
        action: ImportRowAction.CREATE,
        warnings_json: [
          {
            code: 'CUSTOMER_VAT_ID_INVALID',
            message:
              'vat_id is not a valid AT/DE VAT identifier format; imported without UID',
            field: 'vat_id',
          },
        ],
        normalized_json: expect.objectContaining({ vat_id: null }),
      });

      h.prisma.importJob.create.mockClear();
      const [strict] = await dryRunRows(text, { invalid_vat_as_error: true });
      expect(strict).toMatchObject({
        action: ImportRowAction.ERROR,
        errors_json: [
          {
            code: 'CUSTOMER_VAT_ID_INVALID',
            message: 'vat_id is not a valid AT/DE VAT identifier format',
            field: 'vat_id',
          },
        ],
        warnings_json: Prisma.JsonNull,
      });
    });

    it('ignores consent columns and says so as a warning on every row', async () => {
      const text =
        'Kunden-Nr;Vorname;Nachname;Newsletter\nK-1;Anna;Berger;ja\n';

      const [row] = await dryRunRows(text);

      expect(row).toMatchObject({
        action: ImportRowAction.CREATE,
        warnings_json: [
          {
            code: 'IMPORT_CONSENT_COLUMN_IGNORED',
            message: 'Consent/marketing column "Newsletter" is ignored',
            field: 'Newsletter',
          },
        ],
      });
    });

    it('warns about a possible duplicate when a new name matches an existing customer', async () => {
      h.prisma.customer.findMany.mockResolvedValue([existingCustomer()]);
      const text = csvOf(
        withCells({
          [COL.externalId]: 'K-9',
          [COL.firstName]: 'Anna',
          [COL.lastName]: 'Berger',
        }),
      );

      const [row] = await dryRunRows(text);

      expect(row).toMatchObject({
        action: ImportRowAction.CREATE,
        warnings_json: [
          {
            code: 'IMPORT_POSSIBLE_DUPLICATE',
            message: 'A row or existing record may be a duplicate by name',
          },
        ],
      });
    });

    it('matches an existing customer by email and skips it, warning when fields differ', async () => {
      h.prisma.customer.findMany.mockResolvedValue([
        existingCustomer({ email: 'anna@example.com', phone: '111' }),
      ]);
      const text = csvOf(
        withCells({
          [COL.externalId]: 'K-9',
          [COL.email]: 'Anna@Example.com',
          [COL.phone]: '222',
          [COL.firstName]: 'Anna',
          [COL.lastName]: 'Berger',
        }),
      );

      const [row] = await dryRunRows(text);

      expect(row).toMatchObject({
        action: ImportRowAction.SKIP,
        entity_id: 'cust-1',
        warnings_json: [
          {
            code: 'IMPORT_EXISTING_NOT_UPDATED',
            message: 'Existing customer matched but update_existing is false',
          },
        ],
      });
    });

    it('prefers an external id mapping over an email match', async () => {
      h.prisma.externalIdMapping.findMany.mockResolvedValue([
        { external_id: 'K-1', entity_id: 'cust-1' },
      ]);
      h.prisma.customer.findMany.mockResolvedValue([
        existingCustomer({ id: 'cust-1', email: 'other@x.at', phone: '111' }),
        existingCustomer({ id: 'cust-2', email: 'anna@x.at' }),
      ]);
      const text = csvOf(
        withCells({
          [COL.externalId]: 'K-1',
          [COL.email]: 'anna@x.at',
          [COL.phone]: '222',
          [COL.firstName]: 'Anna',
          [COL.lastName]: 'Berger',
        }),
      );

      const [row] = await dryRunRows(text, { update_existing: true });

      expect(row).toMatchObject({
        action: ImportRowAction.UPDATE,
        entity_id: 'cust-1',
      });
    });

    it('treats a difference in empty fields as unchanged under fill_empty_only', async () => {
      h.prisma.customer.findMany.mockResolvedValue([
        existingCustomer({
          email: 'anna@x.at',
          phone: '111',
          address_country: 'AT',
        }),
      ]);
      const text = csvOf(
        withCells({
          [COL.externalId]: 'K-1',
          [COL.email]: 'anna@x.at',
          [COL.phone]: '222',
          [COL.country]: 'AT',
          [COL.firstName]: 'Anna',
          [COL.lastName]: 'Berger',
        }),
      );

      const [filled] = await dryRunRows(text, {
        update_existing: true,
        fill_empty_only: true,
      });
      expect(filled).toMatchObject({
        action: ImportRowAction.SKIP,
        entity_id: 'cust-1',
      });

      h.prisma.importJob.create.mockClear();
      const [overwrite] = await dryRunRows(text, { update_existing: true });
      expect(overwrite).toMatchObject({
        action: ImportRowAction.UPDATE,
        entity_id: 'cust-1',
      });
    });

    it('skips an existing customer that is already identical when update_existing is set', async () => {
      h.prisma.customer.findMany.mockResolvedValue([
        existingCustomer({ email: 'anna@x.at', phone: '111' }),
      ]);
      const text = csvOf(
        withCells({
          [COL.externalId]: 'K-1',
          [COL.email]: 'anna@x.at',
          [COL.phone]: '111',
          [COL.firstName]: 'Anna',
          [COL.lastName]: 'Berger',
        }),
      );

      const [row] = await dryRunRows(text, { update_existing: true });

      expect(row).toMatchObject({
        action: ImportRowAction.SKIP,
        entity_id: 'cust-1',
        warnings_json: Prisma.JsonNull,
      });
    });

    it('scopes the dry-run lookups to the caller tenant and source system', async () => {
      const text = csvOf(
        withCells({
          [COL.externalId]: 'K-1',
          [COL.firstName]: 'A',
          [COL.lastName]: 'B',
        }),
      );

      await dryRunRows(text);

      expect(h.prisma.externalIdMapping.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          entity_type: ImportEntityType.CUSTOMER,
          source_system: SOURCE_SYSTEM,
        },
      });
      expect(h.prisma.customer.findMany).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID },
      });
    });
  });

  describe('apply', () => {
    const createRow = (
      rowNo: number,
      externalId: string,
      normalized: Record<string, unknown>,
    ) =>
      jobRowRecord({
        row_no: rowNo,
        action: ImportRowAction.CREATE,
        external_id: externalId,
        normalized_json: { external_id: externalId, ...normalized },
      });

    beforeEach(() => {
      h.prisma.externalIdMapping.findFirst.mockResolvedValue(null);
      h.prisma.externalIdMapping.create.mockResolvedValue({});
      h.prisma.externalIdMapping.upsert.mockResolvedValue({});
      h.prisma.customer.create.mockResolvedValue({
        id: 'cust-new',
        type: 'COMPANY',
        company_name: 'Autohaus Muster',
        first_name: 'Autohaus Muster',
        last_name: 'Autohaus Muster',
        email: 'info@muster.at',
        phone: null,
        vat_id: null,
        address_street: null,
        address_zip: null,
        address_city: null,
        address_country: 'AT',
      });
    });

    it('creates the customer from the planned row, defaults the country to AT and maps the external id', async () => {
      arrangeApply(
        h,
        importJobRecord({ entity_type: ImportEntityType.CUSTOMER }),
        [
          createRow(1, 'K-1', {
            type: 'COMPANY',
            company_name: 'Autohaus Muster',
            first_name: 'Autohaus Muster',
            last_name: 'Autohaus Muster',
            email: 'info@muster.at',
            phone: null,
            vat_id: null,
            address_street: null,
            address_zip: null,
            address_city: null,
            address_country: null,
          }),
        ],
      );

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.externalIdMapping.findFirst).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          entity_type: ImportEntityType.CUSTOMER,
          source_system: SOURCE_SYSTEM,
          external_id: 'K-1',
        },
      });
      expect(h.prisma.customer.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          type: 'COMPANY',
          company_name: 'Autohaus Muster',
          first_name: 'Autohaus Muster',
          last_name: 'Autohaus Muster',
          email: 'info@muster.at',
          phone: null,
          phone_digits: null,
          vat_id: null,
          address_street: null,
          address_zip: null,
          address_city: null,
          address_country: 'AT',
        },
      });
      expect(h.prisma.externalIdMapping.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: ImportEntityType.CUSTOMER,
          source_system: SOURCE_SYSTEM,
          external_id: 'K-1',
          entity_id: 'cust-new',
          first_seen_import_job_id: JOB_ID,
        },
      });
    });

    it('writes a Customer CREATE audit entry with the new snapshot and no diff', async () => {
      arrangeApply(
        h,
        importJobRecord({ entity_type: ImportEntityType.CUSTOMER }),
        [
          createRow(1, 'K-1', {
            first_name: 'Autohaus Muster',
            last_name: 'Autohaus Muster',
          }),
        ],
      );

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'Customer',
          entity_id: 'cust-new',
          action: AuditLogAction.CREATE,
          actor_user_id: ACTOR_DB_ID,
          actor_email: ACTOR_EMAIL,
          actor_role: 'ADMIN',
          actor_type: 'USER',
          source: 'import',
          before: Prisma.JsonNull,
          after: {
            type: 'COMPANY',
            company_name: 'Autohaus Muster',
            first_name: 'Autohaus Muster',
            last_name: 'Autohaus Muster',
            email: 'info@muster.at',
            phone: null,
            vat_id: null,
            address_street: null,
            address_zip: null,
            address_city: null,
            address_country: 'AT',
            importJobId: JOB_ID,
          },
          diff: Prisma.JsonNull,
        },
      });
    });

    it('updates an existing customer, filling only empty fields, and re-points its mapping', async () => {
      const before = existingCustomer({
        id: 'cust-1',
        email: 'old@x.at',
        phone: null,
        address_street: 'Alt 1',
        address_zip: '1010',
        address_city: 'Wien',
        address_country: 'AT',
      });
      h.prisma.customer.findFirst.mockResolvedValue(before);
      h.prisma.customer.update.mockResolvedValue({ ...before, phone: '555' });
      arrangeApply(
        h,
        importJobRecord({
          entity_type: ImportEntityType.CUSTOMER,
          options_json: { update_existing: true, fill_empty_only: true },
        }),
        [
          jobRowRecord({
            row_no: 1,
            action: ImportRowAction.UPDATE,
            entity_id: 'cust-1',
            external_id: 'K-1',
            normalized_json: {
              external_id: 'K-1',
              type: 'PRIVATE',
              company_name: null,
              first_name: 'Anna',
              last_name: 'Berger',
              email: 'new@x.at',
              phone: '555',
              vat_id: null,
              address_street: null,
              address_zip: null,
              address_city: null,
              address_country: 'AT',
            },
          }),
        ],
      );

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.customer.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { phone: '555', phone_digits: '555' },
      });
      expect(h.prisma.externalIdMapping.upsert).toHaveBeenCalledWith({
        where: {
          tenant_id_entity_type_source_system_external_id: {
            tenant_id: TENANT_ID,
            entity_type: ImportEntityType.CUSTOMER,
            source_system: SOURCE_SYSTEM,
            external_id: 'K-1',
          },
        },
        create: {
          tenant_id: TENANT_ID,
          entity_type: ImportEntityType.CUSTOMER,
          source_system: SOURCE_SYSTEM,
          external_id: 'K-1',
          entity_id: 'cust-1',
          first_seen_import_job_id: JOB_ID,
        },
        update: { entity_id: 'cust-1' },
      });
      expect(h.prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity_type: 'Customer',
          entity_id: 'cust-1',
          action: AuditLogAction.UPDATE,
          diff: { phone: { before: null, after: '555' } },
        }),
      });
    });

    it('marks a CREATE row ROW_STALE when its external id was mapped after the preview', async () => {
      h.prisma.externalIdMapping.findFirst.mockResolvedValue({ id: 'map-1' });
      arrangeApply(
        h,
        importJobRecord({ entity_type: ImportEntityType.CUSTOMER }),
        [createRow(1, 'K-1', { first_name: 'Anna', last_name: 'Berger' })],
      );

      const result = await h.service.applyJob(JOB_ID);

      expect(h.prisma.customer.create).not.toHaveBeenCalled();
      expect(h.prisma.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: TENANT_ID,
            import_job_id: JOB_ID,
            row_no: 1,
          },
        },
        data: {
          action: ImportRowAction.ERROR,
          errors_json: [
            {
              code: IMPORT_ERROR_CODES.ROW_STALE,
              message: 'Import row plan is stale',
            },
          ],
        },
      });
      expect(result).toMatchObject({
        status: ImportJobStatus.APPLIED,
        totals: { error: 1 },
      });
    });

    it('marks an UPDATE row ROW_STALE when the customer was deleted after the preview', async () => {
      h.prisma.customer.findFirst.mockResolvedValue(null);
      arrangeApply(
        h,
        importJobRecord({
          entity_type: ImportEntityType.CUSTOMER,
          options_json: { update_existing: true },
        }),
        [
          jobRowRecord({
            row_no: 1,
            action: ImportRowAction.UPDATE,
            entity_id: 'cust-gone',
            external_id: 'K-1',
            normalized_json: { external_id: 'K-1', first_name: 'Anna' },
          }),
        ],
      );

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.customer.update).not.toHaveBeenCalled();
      expect(h.prisma.importJobRow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            action: ImportRowAction.ERROR,
            errors_json: [
              {
                code: IMPORT_ERROR_CODES.ROW_STALE,
                message: 'Import row plan is stale',
              },
            ],
          },
        }),
      );
    });

    it('turns any per-row failure into an APPLY_FAILED row and keeps the job applied', async () => {
      h.prisma.customer.create.mockRejectedValue(new Error('Connection lost'));
      arrangeApply(
        h,
        importJobRecord({ entity_type: ImportEntityType.CUSTOMER }),
        [createRow(1, 'K-1', { first_name: 'Anna', last_name: 'Berger' })],
      );

      const result = await h.service.applyJob(JOB_ID);

      expect(h.prisma.importJobRow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            action: ImportRowAction.ERROR,
            errors_json: [
              {
                code: IMPORT_ERROR_CODES.APPLY_FAILED,
                message: 'Row failed during apply',
              },
            ],
          },
        }),
      );
      expect(result.status).toBe(ImportJobStatus.APPLIED);
      expect(h.prisma.importJob.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: ImportJobStatus.FAILED }),
        }),
      );
    });

    it('fails the job with the totals so far when recording a row error itself fails', async () => {
      h.prisma.customer.create.mockRejectedValue(new Error('boom'));
      arrangeApply(
        h,
        importJobRecord({ entity_type: ImportEntityType.CUSTOMER }),
        [createRow(1, 'K-1', { first_name: 'Anna', last_name: 'Berger' })],
      );
      // arrangeApply resets importJobRow.update, so the failure is armed after it.
      h.prisma.importJobRow.update.mockRejectedValue(
        new Error('db unavailable'),
      );

      await expect(h.service.applyJob(JOB_ID)).rejects.toThrow(
        'db unavailable',
      );

      expect(h.prisma.importJob.update).toHaveBeenCalledWith({
        where: { id: JOB_ID },
        data: {
          status: ImportJobStatus.FAILED,
          totals_json: { rows: 1, create: 0, update: 0, skip: 0, error: 1 },
        },
      });
    });

    it('counts SKIP and ERROR rows without writing anything for them', async () => {
      arrangeApply(
        h,
        importJobRecord({ entity_type: ImportEntityType.CUSTOMER }),
        [
          jobRowRecord({
            row_no: 1,
            action: ImportRowAction.SKIP,
            external_id: 'K-1',
          }),
          jobRowRecord({
            row_no: 2,
            action: ImportRowAction.ERROR,
            external_id: 'K-2',
          }),
        ],
      );

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.customer.create).not.toHaveBeenCalled();
      expect(h.prisma.customer.update).not.toHaveBeenCalled();
      expect(h.prisma.externalIdMapping.create).not.toHaveBeenCalled();
      expect(h.prisma.importJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totals_json: { rows: 2, create: 0, update: 0, skip: 1, error: 1 },
          }),
        }),
      );
    });

    it('runs one transaction per customer row and none for the applied bookkeeping', async () => {
      arrangeApply(
        h,
        importJobRecord({ entity_type: ImportEntityType.CUSTOMER }),
        [
          createRow(1, 'K-1', { first_name: 'Anna', last_name: 'Berger' }),
          createRow(2, 'K-2', { first_name: 'Bruno', last_name: 'Huber' }),
        ],
      );

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
    });
  });
});

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

describe('ImportService job lifecycle — createDryRunFromUpload decision hooks', () => {
  const h = setupImportHarness();

  describe('createDryRunFromUpload decision hooks', () => {
    it('uses live customer decisions and returns their totals when the tenant is live', async () => {
      const liveTotals = { ...DRY_RUN_CREATE_TOTALS, create: 0, skip: 1 };
      h.decisionLive.applyCustomerImportDecisions.mockResolvedValue({
        mode: 'live',
        totals: liveTotals,
      });

      const result = await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(result.totals).toEqual(liveTotals);
      expect(h.decisionLive.applyCustomerImportDecisions).toHaveBeenCalledWith({
        tenantId: TENANT_ID,
        traceId: TRACE_ID,
        jobId: JOB_ID,
        rows: expect.any(Array),
        totals: DRY_RUN_CREATE_TOTALS,
      });
      expect(
        h.decisionHooks.scheduleCustomerImportDryRunShadows,
      ).not.toHaveBeenCalled();
      // The job itself keeps the dry-run totals; live totals only shape the response.
      expect(
        h.prisma.importJob.create.mock.calls[0][0].data.totals_json,
      ).toEqual(DRY_RUN_CREATE_TOTALS);
    });

    it('schedules shadow decisions and keeps dry-run totals in shadow mode', async () => {
      const result = await h.service.createDryRunFromUpload(
        dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
          mappingJson: CUSTOMER_MAPPING,
        }),
      );

      expect(result.totals).toEqual(DRY_RUN_CREATE_TOTALS);
      expect(
        h.decisionHooks.scheduleCustomerImportDryRunShadows,
      ).toHaveBeenCalledWith(
        TENANT_ID,
        TRACE_ID,
        expect.arrayContaining([
          expect.objectContaining({
            row_no: 1,
            action: ImportRowAction.CREATE,
          }),
        ]),
      );
    });

    it('does not let a failing shadow schedule fail the upload', async () => {
      h.decisionHooks.scheduleCustomerImportDryRunShadows.mockRejectedValue(
        new Error('shadow scheduler down'),
      );

      await expect(
        h.service.createDryRunFromUpload(
          dryRunParams(ImportEntityType.CUSTOMER, CUSTOMER_CSV, {
            mappingJson: CUSTOMER_MAPPING,
          }),
        ),
      ).resolves.toMatchObject({ status: ImportJobStatus.DRY_RUN_DONE });
    });

    it('consults no customer decisions for vehicle or supplier uploads', async () => {
      await h.service.createDryRunFromUpload(
        dryRunParams(
          ImportEntityType.VEHICLE,
          'Fahrzeug-Nr;FIN;Marke;Modell;Baujahr\nV-1;;VW;Golf;2019\n',
          {
            mappingJson: {
              external_id: 'Fahrzeug-Nr',
              vin: 'FIN',
              make: 'Marke',
              model: 'Modell',
              year: 'Baujahr',
            },
            optionsJson: { allow_missing_vin: true },
          },
        ),
      );

      expect(
        h.decisionLive.applyCustomerImportDecisions,
      ).not.toHaveBeenCalled();
      expect(
        h.decisionHooks.scheduleCustomerImportDryRunShadows,
      ).not.toHaveBeenCalled();
    });
  });

});

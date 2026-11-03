import { ImportEntityType, ImportJobStatus, ImportRowAction } from '@prisma/client';
import { serializeImportJob } from './import-job.serializer.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { ImportJobTotals } from './import.types.js';
import {
  JOB_ID,
  TENANT_ID,
  importJobRecord,
  setupImportCollaborators,
  setupImportHarness,
} from './import.service.spec.support.js';

const TOTALS: ImportJobTotals = {
  rows: 2,
  create: 0,
  update: 0,
  skip: 0,
  error: 2,
};

function errorRow(rowNo: number, code: string) {
  return {
    row_no: rowNo,
    action: ImportRowAction.ERROR,
    errors_json: [{ code }],
  };
}

/**
 * Focused spec for the apply dispatcher's technical-error annotation. The
 * facade apply spec covers the HTTP state machine; this covers the annotation
 * the dispatcher adds on top of a serialized job.
 */
describe('ImportApplyDispatcher.annotateTechnicalErrors', () => {
  const h = setupImportHarness();
  const c = setupImportCollaborators(h);

  function serializedJob(status: ImportJobStatus) {
    return serializeImportJob(
      importJobRecord({ status }) as never,
      TOTALS,
    );
  }

  it('counts only technical error rows of the tenant and job', async () => {
    h.prisma.importJobRow.findMany.mockResolvedValue([
      errorRow(1, IMPORT_ERROR_CODES.APPLY_FAILED),
      errorRow(2, 'VEHICLE_PARTY_OVERLAP'),
      errorRow(3, 'P2028'),
    ]);

    const annotated = await c.dispatcher.annotateTechnicalErrors(
      TENANT_ID,
      serializedJob(ImportJobStatus.APPLIED),
    );

    expect(h.prisma.importJobRow.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: TENANT_ID,
        import_job_id: JOB_ID,
        action: ImportRowAction.ERROR,
      },
      orderBy: { row_no: 'asc' },
    });
    expect(annotated.options).toMatchObject({ technical_error_rows: 2 });
  });

  it.each([
    ['DRY_RUN_DONE', ImportJobStatus.DRY_RUN_DONE],
    ['APPLYING', ImportJobStatus.APPLYING],
    ['FAILED', ImportJobStatus.FAILED],
  ])('leaves a %s job unchanged and reads no rows', async (_label, status) => {
    const job = serializedJob(status);

    const annotated = await c.dispatcher.annotateTechnicalErrors(TENANT_ID, job);

    expect(annotated).toEqual(job);
    expect(annotated.options.technical_error_rows).toBeUndefined();
    expect(h.prisma.importJobRow.findMany).not.toHaveBeenCalled();
  });

  it('keeps the entity type and totals of the annotated job', async () => {
    h.prisma.importJobRow.findMany.mockResolvedValue([
      errorRow(1, IMPORT_ERROR_CODES.APPLY_FAILED),
    ]);

    const annotated = await c.dispatcher.annotateTechnicalErrors(
      TENANT_ID,
      serializeImportJob(
        importJobRecord({
          status: ImportJobStatus.APPLIED,
          entity_type: ImportEntityType.VEHICLE,
        }) as never,
        TOTALS,
      ),
    );

    expect(annotated).toMatchObject({
      id: JOB_ID,
      entity_type: ImportEntityType.VEHICLE,
      status: ImportJobStatus.APPLIED,
      totals: TOTALS,
    });
  });
});

import { AuditLogAction, ImportEntityType, ImportRowAction } from '@prisma/client';
import {
  ACTOR_DB_ID,
  ACTOR_EMAIL,
  JOB_ID,
  TENANT_ID,
  arrangeApply,
  importJobRecord,
  jobRowRecord,
  setupImportHarness,
} from './import.service.spec.support.js';

const VIN = '1M8GDM9AXKP042788';

describe('vehicle-import-apply.row (Erstzulassung)', () => {
  const h = setupImportHarness();

  const plannedFields = {
    make: 'VW',
    model: 'Golf',
    year: 2019,
    vin: VIN,
    plate: 'W12AB',
    mileage: 120000,
    color: 'Blau',
    key_number: 'S-7',
    customer_id: 'cust-1',
    owner_external_id_provided: true,
    first_registration_date: null,
  };

  function createRow(rowNo: number, externalId: string, normalized: object) {
    return jobRowRecord({
      row_no: rowNo,
      action: ImportRowAction.CREATE,
      external_id: externalId,
      normalized_json: { external_id: externalId, ...normalized },
    });
  }

  beforeEach(() => {
    h.prisma.externalIdMapping.findFirst.mockResolvedValue(null);
    h.prisma.externalIdMapping.create.mockResolvedValue({});
    h.prisma.externalIdMapping.upsert.mockResolvedValue({});
    h.prisma.vehicle.create.mockResolvedValue({
      id: 'veh-new',
      make: 'VW',
      model: 'Golf',
      year: 2019,
      vin: VIN,
      plate: 'W12AB',
      mileage: 120000,
      color: 'Blau',
      key_number: 'S-7',
      customer_id: 'cust-1',
      first_registration_date: null,
    });
  });

  it('persists first_registration_date on create when normalized value is null', async () => {
    arrangeApply(
      h,
      importJobRecord({ entity_type: ImportEntityType.VEHICLE }),
      [createRow(1, 'V-1', plannedFields)],
    );

    await h.service.applyJob(JOB_ID);

    expect(h.prisma.vehicle.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        first_registration_date: null,
      }),
    });
  });

  it('audits first_registration_date in the vehicle CREATE snapshot', async () => {
    arrangeApply(
      h,
      importJobRecord({ entity_type: ImportEntityType.VEHICLE }),
      [createRow(1, 'V-1', plannedFields)],
    );

    await h.service.applyJob(JOB_ID);

    expect(h.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        after: expect.objectContaining({
          first_registration_date: null,
          importJobId: JOB_ID,
        }),
        action: AuditLogAction.CREATE,
        entity_type: 'Vehicle',
        tenant_id: TENANT_ID,
        actor_user_id: ACTOR_DB_ID,
        actor_email: ACTOR_EMAIL,
      }),
    });
  });
});

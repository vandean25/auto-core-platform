import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { ImportUndoService } from './import-undo.service.js';
import { UNDO_BLOCKED_REASONS } from './import-undo.types.js';
import {
  isUndoLeaseReleased,
  readUndoOutcome,
  readUndoWorkerState,
  type ImportJobOptionsWithUndo,
  type ImportUndoOutcome,
  type ImportUndoWorkerState,
} from './import-undo-worker.js';
import { deterministicImportWorkerTaskId } from './import-worker-task-identity.js';
import type { ImportWorkerTaskIdentity } from './import-worker-task-identity.js';

const TENANT_ID = 'tenant-123';
const JOB_ID = 'job-456';
const APPLIED_AT = new Date('2026-10-30T10:00:00.000Z');
const BEFORE_APPLIED_AT = new Date(APPLIED_AT.getTime() - 1000);

const GUARD_MODELS = [
  'customer',
  'vehicle',
  'laborOperation',
  'catalogItem',
  'vehicleNotice',
  'vehicleParty',
  'invoice',
  'workshopOrder',
  'salesOrder',
  'vehicleSale',
  'vehiclePurchase',
  'loanerBooking',
  'vehicleLedgerEntry',
  'workshopTaskLineItem',
  'inventoryTransaction',
  'invoiceItem',
  'purchaseOrderItem',
  'auditLog',
  'customerConsent',
  'customerContactPoint',
  'legacyDocument',
  'tyreSet',
  'vehicleMedia',
  'vehicleEquipmentSelection',
  'vehicleEquipmentFreeTextItem',
  'vehicleListing',
  'vehicleValuationSnapshot',
  'tyreMeasurement',
  'vehicleInspectionRecord',
] as const;

const ENTITY_MODEL_BY_TYPE: Record<string, string> = {
  CUSTOMER: 'customer',
  VEHICLE: 'vehicle',
  LABOR_OPERATION: 'laborOperation',
  CATALOG_ITEM: 'catalogItem',
  SUPPLIER_PRICE_LIST: 'catalogItem',
  VEHICLE_NOTICE: 'vehicleNotice',
  VEHICLE_PARTY: 'vehicleParty',
};

/** Tables the undo writer touches around an entity but the guard never reads. */
const WRITER_MODELS = [
  'externalIdMapping',
  'customerConsentUnsubscribeToken',
  'customerCommunicationState',
  'vendorArticle',
] as const;

type FakeRow = {
  row_no: number;
  action: ImportRowAction;
  entity_id: string | null;
  normalized_json: Record<string, unknown> | null;
  before_snapshot_json: Record<string, unknown> | null;
  undone_at: Date | null;
};

type FakeHistory = {
  id: string;
  tenant_id: string;
  import_job_id: string;
  catalog_item_id: string;
  old_cost: number | null;
  new_cost: number | null;
  old_retail: number | null;
  new_retail: number | null;
};

type FakeJob = {
  id: string;
  tenant_id: string;
  entity_type: string;
  source_system: string;
  file_name: string;
  file_sha256: string;
  status: ImportJobStatus;
  mapping_json: Record<string, unknown>;
  options_json: Record<string, unknown>;
  totals_json: Record<string, number>;
  created_by: string | null;
  createdAt: Date;
  updatedAt: Date;
  appliedAt: Date | null;
  worker_claim_seq: number;
  worker_recovery_seq: number;
  worker_enqueue_seq: number;
};

type FakeDb = {
  job: FakeJob;
  rows: FakeRow[];
  histories: FakeHistory[];
  entities: Map<string, Record<string, unknown>>;
  refs: Record<string, Record<string, unknown>[]>;
  audits: Record<string, unknown>[];
  deletedEntityIds: string[];
  deletedMappings: string[];
  updatedEntities: Array<{ id: string; data: Record<string, unknown> }>;
  txCount: number;
  /** Simulated worker crash: every transaction after this one throws. */
  killAfterTx: number | null;
  beforeTransaction: (() => void) | null;
};

type Harness = {
  service: ImportUndoService;
  db: FakeDb;
  prisma: Record<string, unknown>;
  cloudTasks: { isEnabled: jest.Mock; enqueueImportWorker: jest.Mock };
  undoOutcome: () => ImportUndoOutcome | null;
  undoWorker: () => ImportUndoWorkerState | null;
  optionsJson: () => ImportJobOptionsWithUndo;
};

function makeRow(
  rowNo: number,
  action: ImportRowAction,
  entityId: string | null,
  beforeSnapshot: Record<string, unknown> | null = null,
): FakeRow {
  return {
    row_no: rowNo,
    action,
    entity_id: entityId,
    normalized_json: entityId ? { id: entityId } : null,
    before_snapshot_json: beforeSnapshot,
    undone_at: null,
  };
}

function makeHistory(
  index: number,
  catalogItemId: string,
  oldCost: number | null,
): FakeHistory {
  const seq = String(index).padStart(4, '0');
  return {
    id: `h-${seq}`,
    tenant_id: TENANT_ID,
    import_job_id: JOB_ID,
    catalog_item_id: catalogItemId,
    old_cost: oldCost,
    new_cost: oldCost == null ? null : oldCost + 10,
    old_retail: oldCost == null ? null : oldCost + 20,
    new_retail: oldCost == null ? null : oldCost + 30,
  };
}

function matchesStatus(
  current: ImportJobStatus,
  expected: unknown,
): boolean {
  if (expected === undefined) return true;
  if (typeof expected === 'string') return current === expected;
  const list = (expected as { in?: unknown[] }).in;
  return Array.isArray(list) ? list.includes(current) : true;
}

/** Resolves the `options_json: { path, equals }` filter the lease claim uses. */
function matchesJsonPath(
  options: Record<string, unknown>,
  filter: unknown,
): boolean {
  if (filter === undefined) return true;
  const { path, equals } = filter as { path?: string[]; equals?: unknown };
  if (!Array.isArray(path)) return true;
  let value: unknown = options;
  for (const segment of path) {
    if (value === null || typeof value !== 'object') return false;
    value = (value as Record<string, unknown>)[segment];
  }
  return value === equals;
}

function applyJobUpdate(
  db: FakeDb,
  where: Record<string, unknown>,
  data: Record<string, unknown>,
): { count: number } {
  if (!matchesStatus(db.job.status, where.status)) {
    return { count: 0 };
  }
  const expectedUpdatedAt = where.updatedAt as Date | undefined;
  if (
    expectedUpdatedAt &&
    expectedUpdatedAt.getTime() !== db.job.updatedAt.getTime()
  ) {
    return { count: 0 };
  }
  if (!matchesJsonPath(db.job.options_json, where.options_json)) {
    return { count: 0 };
  }
  if (typeof data.status === 'string') {
    db.job.status = data.status as ImportJobStatus;
  }
  if (data.options_json) {
    db.job.options_json = data.options_json as Record<string, unknown>;
  }
  if (data.worker_recovery_seq) {
    db.job.worker_recovery_seq += 1;
  }
  if (data.worker_claim_seq) {
    db.job.worker_claim_seq += 1;
  }
  db.job.updatedAt = new Date(db.job.updatedAt.getTime() + 1);
  return { count: 1 };
}

function selectRows(db: FakeDb, where: Record<string, unknown>, take?: number) {
  const actions = (where.action as { in?: ImportRowAction[] } | undefined)?.in;
  const cursor = (where.row_no as { gt?: number } | undefined)?.gt;
  const undoneFilter = where.undone_at as { not?: null } | null | undefined;
  const rows = db.rows
    .filter((row) => {
      if (actions && !actions.includes(row.action)) return false;
      if (undoneFilter === null && row.undone_at !== null) return false;
      if (undoneFilter && 'not' in undoneFilter && row.undone_at === null) {
        return false;
      }
      if (typeof cursor === 'number' && row.row_no <= cursor) return false;
      return true;
    })
    .sort((a, b) => a.row_no - b.row_no);
  return take ? rows.slice(0, take) : rows;
}

function selectHistories(
  db: FakeDb,
  where: Record<string, unknown>,
  take?: number,
) {
  const cursor = (where.id as { gt?: string } | undefined)?.gt;
  const histories = db.histories
    .filter((history) => {
      if (history.import_job_id !== where.import_job_id) return false;
      if (typeof cursor === 'string' && history.id <= cursor) return false;
      return true;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  return take ? histories.slice(0, take) : histories;
}

type DbSnapshot = {
  job: FakeJob;
  rows: FakeRow[];
  histories: FakeHistory[];
  entities: Array<[string, Record<string, unknown>]>;
  audits: Record<string, unknown>[];
  deletedEntityIds: string[];
  deletedMappings: string[];
  updatedEntities: Array<{ id: string; data: Record<string, unknown> }>;
};

function takeSnapshot(db: FakeDb): DbSnapshot {
  return {
    job: { ...db.job },
    rows: db.rows.map((row) => ({ ...row })),
    histories: [...db.histories],
    entities: [...db.entities.entries()],
    audits: [...db.audits],
    deletedEntityIds: [...db.deletedEntityIds],
    deletedMappings: [...db.deletedMappings],
    updatedEntities: [...db.updatedEntities],
  };
}

/** A failed transaction must not leave partial writes behind, exactly like Postgres. */
function restoreSnapshot(db: FakeDb, snapshot: DbSnapshot): void {
  Object.assign(db.job, snapshot.job);
  db.rows = snapshot.rows;
  db.histories = snapshot.histories;
  db.entities.clear();
  for (const [id, entity] of snapshot.entities) db.entities.set(id, entity);
  db.audits = snapshot.audits;
  db.deletedEntityIds = snapshot.deletedEntityIds;
  db.deletedMappings = snapshot.deletedMappings;
  db.updatedEntities = snapshot.updatedEntities;
}

function createHarness(
  params: {
    entityType?: string;
    status?: ImportJobStatus;
    rows?: FakeRow[];
    histories?: FakeHistory[];
    entities?: Record<string, Record<string, unknown>>;
    refs?: Record<string, Record<string, unknown>[]>;
    options?: Record<string, unknown>;
    totals?: Record<string, number>;
  } = {},
): Harness {
  const entityType = String(params.entityType ?? ImportEntityType.CUSTOMER);
  const rows = params.rows ?? [];
  const entities = new Map<string, Record<string, unknown>>(
    Object.entries(
      params.entities ??
        Object.fromEntries(
          rows
            .filter((row) => row.entity_id)
            .map((row) => [
              row.entity_id as string,
              { id: row.entity_id, tenant_id: TENANT_ID, updatedAt: BEFORE_APPLIED_AT },
            ]),
        ),
    ),
  );

  const db: FakeDb = {
    job: {
      id: JOB_ID,
      tenant_id: TENANT_ID,
      entity_type: entityType,
      source_system: 'legacy',
      file_name: 'customers.csv',
      file_sha256: 'sha-1',
      status: params.status ?? ImportJobStatus.APPLIED,
      mapping_json: {},
      options_json: params.options ?? {},
      totals_json: params.totals ?? { create: rows.length, update: 0 },
      created_by: 'admin-user',
      createdAt: new Date('2026-10-30T09:00:00.000Z'),
      updatedAt: new Date('2026-10-30T10:00:01.000Z'),
      appliedAt: APPLIED_AT,
      worker_claim_seq: 0,
      worker_recovery_seq: 0,
      worker_enqueue_seq: 0,
    },
    rows,
    histories: params.histories ?? [],
    entities,
    refs: params.refs ?? {},
    audits: [],
    deletedEntityIds: [],
    deletedMappings: [],
    updatedEntities: [],
    txCount: 0,
    killAfterTx: null,
    beforeTransaction: null,
  };

  const entityModel = ENTITY_MODEL_BY_TYPE[entityType] ?? 'customer';
  const prisma: Record<string, any> = {};

  for (const model of GUARD_MODELS) {
    prisma[model] = {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (model === entityModel) {
          const ids = ((where.id as { in?: string[] } | undefined)?.in ??
            []);
          return ids
            .map((id) => entities.get(id))
            .filter((row): row is Record<string, unknown> => Boolean(row));
        }
        return db.refs[model] ?? [];
      }),
      findFirst: jest.fn(async () => null),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      updateMany: jest.fn(async () => ({ count: 0 })),
    };
  }

  prisma[entityModel].deleteMany = jest.fn(
    async ({ where }: { where: { id: string } }) => {
      db.deletedEntityIds.push(where.id);
      entities.delete(where.id);
      return { count: 1 };
    },
  );
  prisma[entityModel].updateMany = jest.fn(
    async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      db.updatedEntities.push({ id: where.id, data });
      return { count: 1 };
    },
  );
  for (const model of WRITER_MODELS) {
    prisma[model] = {
      deleteMany: jest.fn(async () => ({ count: 0 })),
    };
  }
  prisma.externalIdMapping.deleteMany = jest.fn(
    async ({ where }: { where: { entity_id: string } }) => {
      db.deletedMappings.push(where.entity_id);
      return { count: 1 };
    },
  );
  prisma.catalogPriceHistory = {
    findMany: jest.fn(
      async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
        selectHistories(db, where, take),
    ),
    count: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        selectHistories(db, where).length,
    ),
    deleteMany: jest.fn(async ({ where }: { where: { id?: string } }) => {
      if (where.id) {
        db.histories = db.histories.filter(
          (history) => history.id !== where.id,
        );
        return { count: 1 };
      }
      return { count: 0 };
    }),
  };
  prisma.auditLog = {
    findMany: jest.fn(async () => db.refs.auditLog ?? []),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      db.audits.push(data);
      return { id: `audit-${db.audits.length}` };
    }),
  };
  prisma.importJob = {
    findFirst: jest.fn(async () => ({ ...db.job })),
    findMany: jest.fn(async () =>
      db.job.status === ImportJobStatus.UNDOING ? [{ id: db.job.id }] : [],
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => applyJobUpdate(db, where, data),
    ),
  };
  prisma.importJobRow = {
    findMany: jest.fn(
      async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
        selectRows(db, where, take),
    ),
    count: jest.fn(
      async ({ where }: { where: Record<string, unknown> }) =>
        selectRows(db, where).length,
    ),
    update: jest.fn(
      async ({ where }: { where: { tenant_id_import_job_id_row_no: { row_no: number } } }) => {
        const row = db.rows.find(
          (candidate) =>
            candidate.row_no === where.tenant_id_import_job_id_row_no.row_no,
        );
        if (row) row.undone_at = new Date();
        return { row_no: row?.row_no };
      },
    ),
  };
  prisma.user = {
    findUnique: jest.fn(async () => ({ id: 'admin-user' })),
  };
  prisma.tenantMember = {
    findFirst: jest.fn(async () => ({ id: 'member-1' })),
  };
  prisma.$transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
    db.beforeTransaction?.();
    db.txCount += 1;
    if (db.killAfterTx !== null && db.txCount > db.killAfterTx) {
      throw new Error('column "x" of relation "y" does not exist');
    }
    const snapshot = takeSnapshot(db);
    try {
      return await callback(prisma);
    } catch (error) {
      restoreSnapshot(db, snapshot);
      throw error;
    }
  });

  const tenantContext = {
    getTenantId: jest.fn(async () => TENANT_ID),
    getAuthenticatedUser: jest.fn(() => ({
      userId: 'firebase-admin',
      email: 'admin@example.com',
      role: 'ADMIN',
    })),
  };
  const systemPrisma = {
    withCronJobLock: jest.fn(async (_name: string, task: () => Promise<void>) => {
      await task();
      return true;
    }),
    tenant: { findMany: jest.fn(async () => [{ id: TENANT_ID }]) },
  };
  const requestContext = {
    runAsWorker: jest.fn(
      async (_tenantId: string, task: () => Promise<void>) => task(),
    ),
  };
  const cloudTasks = {
    isEnabled: jest.fn(() => false),
    enqueueImportWorker: jest.fn(async () => undefined),
  };

  const service = new ImportUndoService(
    tenantContext as never,
    prisma as never,
    systemPrisma as never,
    requestContext as never,
    cloudTasks as never,
  );

  const optionsJson = () => db.job.options_json as ImportJobOptionsWithUndo;

  return {
    service,
    db,
    prisma,
    cloudTasks,
    undoOutcome: () => readUndoOutcome(optionsJson()),
    undoWorker: () => readUndoWorkerState(optionsJson()),
    optionsJson,
  };
}

async function withEnv<T>(
  vars: Record<string, string>,
  run: () => Promise<T>,
): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

/** Ages the worker heartbeat so the stale-claim threshold is exceeded. */
function expireUndoClaim(harness: Harness): void {
  const options = harness.optionsJson();
  const worker = options.undo_worker;
  if (!worker) return;
  harness.db.job.options_json = {
    ...options,
    undo_worker: {
      ...worker,
      heartbeat_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      lease_until: new Date(Date.now() - 60_000).toISOString(),
    },
  };
}

describe('ImportUndoService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('claim and authorization', () => {
    it('rejects non-admin roles', async () => {
      const harness = createHarness();
      const tenantContext = (harness.service as any).tenantContext;
      tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: 'firebase-tech',
        role: 'TECH',
      });

      await expect(harness.service.undoJob(JOB_ID)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('requires a real actor and never falls back to a system actor', async () => {
      const harness = createHarness();
      (harness.prisma as any).user.findUnique.mockResolvedValue(null);

      await expect(harness.service.undoJob(JOB_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(harness.db.audits).toHaveLength(0);
    });

    it('throws NotFound when the job does not exist', async () => {
      const harness = createHarness();
      (harness.prisma as any).importJob.findFirst.mockResolvedValue(null);

      await expect(harness.service.undoJob(JOB_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('is idempotent when the job is already UNDONE', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.CREATE, 'cust-1')],
        status: ImportJobStatus.UNDONE,
        options: {
          undo: {
            status: 'UNDONE',
            undone_at: '2026-10-30T11:00:00.000Z',
            deleted: 1,
            restored: 0,
            blocked: 0,
            blocked_reasons: {},
          },
        },
      });

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.db.deletedEntityIds).toEqual([]);
      expect(harness.db.txCount).toBe(0);
    });

    it('answers IMPORT_JOB_BUSY while the job is applying', async () => {
      const harness = createHarness({ status: ImportJobStatus.APPLYING });

      await expect(harness.service.undoJob(JOB_ID)).rejects.toMatchObject({
        response: { code: 'IMPORT_JOB_BUSY' },
      });
    });

    it('answers IMPORT_JOB_BUSY while another worker holds a fresh undo claim', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.CREATE, 'cust-1')],
        status: ImportJobStatus.UNDOING,
      });
      harness.db.job.options_json = {
        undo_worker: {
          lease_token: 'other-worker',
          lease_until: new Date(Date.now() + 60_000).toISOString(),
          started_at: new Date().toISOString(),
          heartbeat_at: new Date().toISOString(),
          actor_user_id: 'admin-user',
          actor_email: null,
          actor_role: null,
          resume_status: ImportJobStatus.APPLIED,
          confirmed_entity_ids: [],
          cursor: '0',
          processed_rows: 0,
          total_rows: 1,
          deleted_rows: 0,
          restored_rows: 0,
          blocked_reasons: {},
        },
      };

      await expect(harness.service.undoJob(JOB_ID)).rejects.toMatchObject({
        response: { code: 'IMPORT_JOB_BUSY' },
      });
      expect(harness.db.deletedEntityIds).toEqual([]);
    });

    it('answers IMPORT_JOB_BUSY for an UNDOING job without a claim instead of adopting it', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.CREATE, 'cust-1')],
        status: ImportJobStatus.UNDOING,
      });
      harness.db.job.options_json = {};

      await expect(harness.service.undoJob(JOB_ID)).rejects.toMatchObject({
        response: { code: 'IMPORT_JOB_BUSY' },
      });
      expect(harness.db.txCount).toBe(0);
      expect(harness.db.deletedEntityIds).toEqual([]);
    });

    it('refuses to adopt a claim that lost its actor and counters', async () => {
      const harness = createHarness({ status: ImportJobStatus.UNDOING });
      harness.db.job.options_json = {
        undo_worker: {
          lease_token: 'corrupt-claim',
          lease_until: new Date(Date.now() - 1_000).toISOString(),
          heartbeat_at: new Date(Date.now() - 10 * 60_000).toISOString(),
        },
      };

      await expect(harness.service.undoJob(JOB_ID)).rejects.toMatchObject({
        response: { code: 'IMPORT_JOB_BUSY' },
      });
      expect(harness.db.txCount).toBe(0);
    });

    it('answers IMPORT_JOB_CONFLICT when the atomic claim loses the race', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.CREATE, 'cust-1')],
      });
      (harness.prisma as any).importJob.updateMany.mockResolvedValueOnce({
        count: 0,
      });

      await expect(harness.service.undoJob(JOB_ID)).rejects.toMatchObject({
        response: { code: 'IMPORT_JOB_CONFLICT' },
      });
    });

    it('answers IMPORT_JOB_PURGED when staged rows were purged', async () => {
      const harness = createHarness({ options: { rows_purged: true } });

      await expect(harness.service.undoJob(JOB_ID)).rejects.toThrow(
        ConflictException,
      );
      await expect(harness.service.undoJob(JOB_ID)).rejects.toMatchObject({
        response: { code: 'IMPORT_JOB_PURGED' },
      });
    });

    it('answers IMPORT_JOB_EXPIRED when the job expired', async () => {
      const harness = createHarness({
        options: { cancel_reason: 'expired' },
      });

      await expect(harness.service.undoJob(JOB_ID)).rejects.toMatchObject({
        response: { code: 'IMPORT_JOB_EXPIRED' },
      });
    });

    it('refuses document and financial imports', async () => {
      const harness = createHarness({
        entityType: ImportEntityType.LEGACY_INVOICE,
      });

      await expect(harness.service.undoJob(JOB_ID)).rejects.toThrow(
        BadRequestException,
      );
      await expect(harness.service.undoJob(JOB_ID)).rejects.toMatchObject({
        response: { code: 'IMPORT_JOB_NOT_UNDOABLE' },
      });
    });
    it('refuses a dry-run job that never applied', async () => {
      const harness = createHarness({
        status: ImportJobStatus.DRY_RUN_DONE,
        totals: { create: 0, update: 0 },
      });

      await expect(harness.service.undoJob(JOB_ID)).rejects.toMatchObject({
        response: { code: 'IMPORT_JOB_NOT_UNDOABLE' },
      });
    });

    it('refuses a FAILED job that never applied a row', async () => {
      const harness = createHarness({
        status: ImportJobStatus.FAILED,
        totals: { create: 0, update: 0, error: 2 },
      });

      await expect(harness.service.undoJob(JOB_ID)).rejects.toMatchObject({
        response: { code: 'IMPORT_JOB_NOT_UNDOABLE' },
      });
      expect(harness.db.txCount).toBe(0);
    });
  });

  describe('background dispatch', () => {
    it('enqueues a background undo task and answers 202 instead of undoing inline', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.CREATE, 'cust-1')],
      });
      harness.cloudTasks.isEnabled.mockReturnValue(true);

      const result = await withEnv(
        { CLOUD_TASKS_TARGET_BASE_URL: 'https://api.example.test' },
        () => harness.service.undoJobHttp(JOB_ID),
      );

      expect(result.httpStatus).toBe(202);
      expect(result.job.status).toBe(ImportJobStatus.UNDOING);
      expect(harness.cloudTasks.enqueueImportWorker).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_ID, jobId: JOB_ID, phase: 'undo' }),
      );
      expect(harness.db.deletedEntityIds).toEqual([]);
      expect(harness.db.job.status).toBe(ImportJobStatus.UNDOING);
    });

    it('seeds the claim with the actor, the confirmed ids and the previous counts', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.CREATE, 'cust-1')],
        options: {
          undo: {
            status: 'PARTIALLY_UNDONE',
            undone_at: '2026-10-30T11:00:00.000Z',
            deleted: 3,
            restored: 2,
            blocked: 1,
            blocked_reasons: { 'cust-old': UNDO_BLOCKED_REASONS.UNKNOWN },
          },
        },
        totals: { create: 6, update: 0 },
      });
      harness.cloudTasks.isEnabled.mockReturnValue(true);

      await withEnv({ CLOUD_TASKS_TARGET_BASE_URL: 'https://api.example.test' }, () =>
        harness.service.undoJobHttp(JOB_ID, {
          confirmedEntityIds: ['cust-1'],
        }),
      );

      const worker = harness.undoWorker();
      expect(worker?.actor_user_id).toBe('admin-user');
      expect(worker?.confirmed_entity_ids).toEqual(['cust-1']);
      expect(worker?.deleted_rows).toBe(3);
      expect(worker?.restored_rows).toBe(2);
      expect(worker?.blocked_reasons).toEqual({
        'cust-old': UNDO_BLOCKED_REASONS.UNKNOWN,
      });
      expect(worker?.total_rows).toBe(1);
    });
  });

  describe('undo apply', () => {
    it('deletes created customers with their mappings and audits them', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.CREATE, 'cust-1')],
      });

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.db.deletedEntityIds).toEqual(['cust-1']);
      expect(harness.db.deletedMappings).toEqual(['cust-1']);
      expect(harness.db.rows[0].undone_at).toBeInstanceOf(Date);
      expect(harness.undoOutcome()).toMatchObject({
        status: 'UNDONE',
        deleted: 1,
        restored: 0,
        blocked: 0,
      });
      const jobAudit = harness.db.audits.find(
        (entry) => entry.entity_type === 'ImportJob',
      );
      expect(jobAudit?.actor_user_id).toBe('admin-user');
    });

    it('undoes the applied rows of a FAILED job and keeps FAILED as the resume status', async () => {
      const harness = createHarness({
        status: ImportJobStatus.FAILED,
        rows: [
          makeRow(1, ImportRowAction.CREATE, 'cust-1'),
          makeRow(2, ImportRowAction.ERROR, null),
        ],
        totals: { create: 1, update: 0, error: 1 },
      });
      let resumeStatus: string | null = null;
      harness.db.beforeTransaction = () => {
        resumeStatus ??= harness.undoWorker()?.resume_status ?? null;
      };

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.db.deletedEntityIds).toEqual(['cust-1']);
      expect(harness.db.rows[1].undone_at).toBeNull();
      expect(harness.undoOutcome()).toMatchObject({
        deleted: 1,
        restored: 0,
        blocked: 0,
      });
      expect(resumeStatus).toBe(ImportJobStatus.FAILED);
    });

    it('restores updated customers from the before snapshot', async () => {
      const before = { first_name: 'Original', last_name: 'Name' };
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.UPDATE, 'cust-2', before)],
        totals: { create: 0, update: 1 },
      });

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.db.updatedEntities).toEqual([
        { id: 'cust-2', data: expect.objectContaining(before) },
      ]);
      expect(harness.undoOutcome()).toMatchObject({ restored: 1, deleted: 0 });
    });

    it('leaves blocked records untouched and reports PARTIALLY_UNDONE', async () => {
      const harness = createHarness({
        rows: [
          makeRow(1, ImportRowAction.CREATE, 'cust-clean'),
          makeRow(2, ImportRowAction.CREATE, 'cust-blocked'),
        ],
        refs: {
          invoice: [{ id: 'inv-1', customer_id: 'cust-blocked' }],
        },
        totals: { create: 2, update: 0 },
      });

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(harness.db.deletedEntityIds).toEqual(['cust-clean']);
      expect(harness.undoOutcome()).toMatchObject({
        deleted: 1,
        blocked: 1,
        blocked_reasons: {
          'cust-blocked': UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
        },
      });
    });

    it('skips unconfirmed conflicts and reverts confirmed ones', async () => {
      const rows = [makeRow(1, ImportRowAction.CREATE, 'cust-conflict')];
      const entities = {
        'cust-conflict': {
          id: 'cust-conflict',
          tenant_id: TENANT_ID,
          updatedAt: new Date(APPLIED_AT.getTime() + 10_000),
        },
      };

      const unconfirmed = createHarness({
        rows: rows.map((row) => ({ ...row })),
        entities,
        totals: { create: 1, update: 0 },
      });
      const unconfirmedJob = await unconfirmed.service.undoJob(JOB_ID);
      expect(unconfirmedJob.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(unconfirmed.db.deletedEntityIds).toEqual([]);
      expect(unconfirmed.undoOutcome()?.blocked_reasons).toEqual({
        'cust-conflict': UNDO_BLOCKED_REASONS.MODIFIED_SINCE_IMPORT,
      });

      const confirmed = createHarness({
        rows: rows.map((row) => ({ ...row })),
        entities,
        totals: { create: 1, update: 0 },
      });
      const confirmedJob = await confirmed.service.undoJob(JOB_ID, {
        confirmedEntityIds: ['cust-conflict'],
      });
      expect(confirmedJob.status).toBe(ImportJobStatus.UNDONE);
      expect(confirmed.db.deletedEntityIds).toEqual(['cust-conflict']);
    });

    it('blocks UPDATE rows without a before snapshot', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.UPDATE, 'cust-nosnap', null)],
        totals: { create: 0, update: 1 },
      });

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(harness.db.updatedEntities).toEqual([]);
      expect(harness.undoOutcome()?.blocked_reasons).toEqual({
        'cust-nosnap': UNDO_BLOCKED_REASONS.MISSING_BEFORE_SNAPSHOT,
      });
    });

    it('only undoes rows that are still pending after a partial run', async () => {
      const doneRow = makeRow(1, ImportRowAction.CREATE, 'cust-already-done');
      doneRow.undone_at = new Date('2026-10-31T12:00:00.000Z');
      const harness = createHarness({
        rows: [doneRow, makeRow(2, ImportRowAction.CREATE, 'cust-remaining')],
        status: ImportJobStatus.PARTIALLY_UNDONE,
        totals: { create: 2, update: 0 },
      });

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.db.deletedEntityIds).toEqual(['cust-remaining']);
    });

    it('reports ROWS_PURGED when nothing was left to undo', async () => {
      const harness = createHarness({ rows: [], totals: { create: 4, update: 0 } });

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(harness.undoOutcome()?.blocked_reasons).toEqual({
        [`job-${JOB_ID}`]: UNDO_BLOCKED_REASONS.ROWS_PURGED,
      });
    });

    it('skips the job audit when the finalize update lost the race', async () => {
      const harness = createHarness({ rows: [], totals: { create: 0, update: 0 } });
      harness.cloudTasks.isEnabled.mockReturnValue(true);
      await withEnv({ CLOUD_TASKS_TARGET_BASE_URL: 'https://api.example.test' }, () =>
        harness.service.undoJobHttp(JOB_ID),
      );
      (harness.prisma as any).importJob.updateMany.mockResolvedValue({ count: 0 });

      await harness.service.runUndoWorkerAttempt({
        tenantId: TENANT_ID,
        jobId: JOB_ID,
      });

      expect(harness.db.job.status).toBe(ImportJobStatus.UNDOING);
      expect(harness.db.audits).toHaveLength(0);
    });
  });

  describe('worker lease', () => {
    it('stops writing as soon as another worker takes over the claim', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.CREATE, 'cust-1')],
        status: ImportJobStatus.UNDOING,
      });
      const lease = {
        lease_token: 'lease-a',
        lease_until: new Date(Date.now() + 60_000).toISOString(),
        started_at: new Date().toISOString(),
        heartbeat_at: new Date().toISOString(),
        actor_user_id: 'admin-user',
        actor_email: null,
        actor_role: null,
        resume_status: ImportJobStatus.APPLIED,
        confirmed_entity_ids: [],
        cursor: '0',
        processed_rows: 0,
        total_rows: 1,
        deleted_rows: 0,
        restored_rows: 0,
        blocked_reasons: {},
      };
      harness.db.job.options_json = { undo_worker: lease };
      harness.db.beforeTransaction = () => {
        (harness.db.job.options_json as ImportJobOptionsWithUndo).undo_worker = {
          ...lease,
          lease_token: 'lease-b',
        };
      };

      await harness.service.runUndoWorkerAttempt({
        tenantId: TENANT_ID,
        jobId: JOB_ID,
      });

      expect(harness.db.job.status).toBe(ImportJobStatus.UNDOING);
      expect(harness.db.deletedEntityIds).toEqual([]);
      expect(harness.db.audits).toHaveLength(0);
    });
  });

  describe('per-row failure isolation', () => {
    it('keeps the neighbouring rows and stores only a reason code', async () => {
      const harness = createHarness({
        rows: [
          makeRow(1, ImportRowAction.CREATE, 'cust-ok-1'),
          makeRow(2, ImportRowAction.CREATE, 'cust-broken'),
          makeRow(3, ImportRowAction.CREATE, 'cust-ok-2'),
        ],
        totals: { create: 3, update: 0 },
      });
      const rawMessage = 'duplicate key value violates unique constraint "x_pkey"';
      (harness.prisma as any).customer.deleteMany.mockImplementation(
        async ({ where }: { where: { id: string } }) => {
          if (where.id === 'cust-broken') throw new Error(rawMessage);
          harness.db.deletedEntityIds.push(where.id);
          return { count: 1 };
        },
      );

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(harness.db.deletedEntityIds.sort()).toEqual([
        'cust-ok-1',
        'cust-ok-2',
      ]);
      const outcome = harness.undoOutcome();
      expect(outcome).toMatchObject({
        deleted: 2,
        blocked: 1,
        blocked_reasons: {
          'cust-broken': UNDO_BLOCKED_REASONS.ROW_ERROR,
        },
      });
      expect(JSON.stringify(harness.optionsJson())).not.toContain(rawMessage);
      // Only rows that were really undone are marked, so a later run can retry the failed one.
      expect(harness.db.rows.map((row) => row.undone_at !== null)).toEqual([
        true,
        false,
        true,
      ]);
    });

    it('never leaks a raw database message into the client payload', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.CREATE, 'cust-1')],
      });
      const rawMessage =
        'ERROR: null value in column "tenant_id" violates not-null constraint';
      (harness.prisma as any).customer.deleteMany.mockImplementation(() => {
        throw new Error(rawMessage);
      });

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(JSON.stringify(job)).not.toContain('violates not-null constraint');
      expect(harness.undoOutcome()?.blocked_reasons).toEqual({
        'cust-1': UNDO_BLOCKED_REASONS.ROW_ERROR,
      });
    });

    it('retries a failed row on the next run and keeps both runs in the counts', async () => {
      const harness = createHarness({
        rows: [
          makeRow(1, ImportRowAction.CREATE, 'cust-ok'),
          makeRow(2, ImportRowAction.CREATE, 'cust-flaky'),
        ],
        totals: { create: 2, update: 0 },
      });
      let failFlaky = true;
      (harness.prisma as any).customer.deleteMany.mockImplementation(
        async ({ where }: { where: { id: string } }) => {
          if (where.id === 'cust-flaky' && failFlaky) {
            throw new Error('deadlock detected');
          }
          harness.db.deletedEntityIds.push(where.id);
          harness.db.entities.delete(where.id);
          return { count: 1 };
        },
      );

      const first = await harness.service.undoJob(JOB_ID);
      expect(first.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(harness.undoOutcome()).toMatchObject({
        deleted: 1,
        blocked: 1,
        blocked_reasons: { 'cust-flaky': UNDO_BLOCKED_REASONS.ROW_ERROR },
      });

      failFlaky = false;
      const second = await harness.service.undoJob(JOB_ID);
      expect(second.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.undoOutcome()).toMatchObject({
        deleted: 2,
        restored: 0,
        blocked: 0,
        blocked_reasons: {},
      });
      expect(harness.db.deletedEntityIds).toEqual(['cust-ok', 'cust-flaky']);
    });
  });

  describe('supplier price list undo', () => {
    function priceHarness(
      histories: FakeHistory[],
      entities: Record<string, Record<string, unknown>>,
      refs: Record<string, Record<string, unknown>[]> = {},
    ) {
      return createHarness({
        entityType: ImportEntityType.SUPPLIER_PRICE_LIST,
        rows: [],
        histories,
        entities,
        refs,
        totals: { create: 0, update: histories.length },
      });
    }

    const catalogItem = (id: string) => ({
      id,
      tenant_id: TENANT_ID,
      updatedAt: BEFORE_APPLIED_AT,
    });

    it('restores prices and deletes the history row', async () => {
      const harness = priceHarness(
        [makeHistory(1, 'item-1', 15)],
        { 'item-1': catalogItem('item-1') },
      );

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.db.updatedEntities).toEqual([
        { id: 'item-1', data: { cost_price: 15, retail_price: 35 } },
      ]);
      expect(harness.db.histories).toHaveLength(0);
      expect(harness.undoOutcome()).toMatchObject({ restored: 1, blocked: 0 });
    });

    it('counts a blocked catalog item once even with several history rows', async () => {
      const harness = priceHarness(
        [makeHistory(1, 'item-blocked', 15), makeHistory(2, 'item-blocked', 16)],
        { 'item-blocked': catalogItem('item-blocked') },
        { invoiceItem: [{ id: 'ii-1', catalog_item_id: 'item-blocked' }] },
      );

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(harness.undoOutcome()).toMatchObject({
        restored: 0,
        blocked: 1,
        blocked_reasons: {
          'item-blocked': UNDO_BLOCKED_REASONS.DOWNSTREAM_INVOICE,
        },
      });
      expect(harness.db.updatedEntities).toEqual([]);
      expect(harness.db.histories).toHaveLength(2);
    });

    it('does not skip valid entries that follow a blocked one', async () => {
      const harness = priceHarness(
        [
          makeHistory(1, 'item-blocked', 15),
          makeHistory(2, 'item-ok-1', 20),
          makeHistory(3, 'item-ok-2', 25),
        ],
        {
          'item-blocked': catalogItem('item-blocked'),
          'item-ok-1': catalogItem('item-ok-1'),
          'item-ok-2': catalogItem('item-ok-2'),
        },
        { invoiceItem: [{ id: 'ii-1', catalog_item_id: 'item-blocked' }] },
      );

      const job = await withEnv({ IMPORT_UNDO_BATCH_SIZE: '1' }, () =>
        harness.service.undoJob(JOB_ID),
      );

      expect(job.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(harness.db.updatedEntities.map((entry) => entry.id)).toEqual([
        'item-ok-1',
        'item-ok-2',
      ]);
      expect(harness.undoOutcome()).toMatchObject({ restored: 2, blocked: 1 });
      expect(harness.db.histories.map((entry) => entry.id)).toEqual(['h-0001']);
    });

    it('terminates when every entry in every batch is blocked', async () => {
      const harness = priceHarness(
        [
          makeHistory(1, 'item-a', 15),
          makeHistory(2, 'item-b', 16),
          makeHistory(3, 'item-c', 17),
        ],
        {
          'item-a': catalogItem('item-a'),
          'item-b': catalogItem('item-b'),
          'item-c': catalogItem('item-c'),
        },
        {
          invoiceItem: [
            { id: 'ii-1', catalog_item_id: 'item-a' },
            { id: 'ii-2', catalog_item_id: 'item-b' },
            { id: 'ii-3', catalog_item_id: 'item-c' },
          ],
        },
      );

      const job = await withEnv({ IMPORT_UNDO_BATCH_SIZE: '1' }, () =>
        harness.service.undoJob(JOB_ID),
      );

      expect(job.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(harness.undoOutcome()).toMatchObject({ restored: 0, blocked: 3 });
      expect(harness.db.histories).toHaveLength(3);
    });

    it('blocks a price entry without an old cost snapshot', async () => {
      const harness = priceHarness(
        [makeHistory(1, 'item-no-old', null)],
        { 'item-no-old': catalogItem('item-no-old') },
      );

      const job = await harness.service.undoJob(JOB_ID);

      expect(job.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
      expect(harness.db.updatedEntities).toEqual([]);
      expect(harness.undoOutcome()?.blocked_reasons).toEqual({
        'item-no-old': UNDO_BLOCKED_REASONS.MISSING_BEFORE_SNAPSHOT,
      });
    });
  });

  describe('crash, resume and recovery', () => {
    function crashedHarness(rowCount: number, killAfterTx: number) {
      const harness = createHarness({
        rows: Array.from({ length: rowCount }, (_, index) =>
          makeRow(index + 1, ImportRowAction.CREATE, `cust-${index + 1}`),
        ),
        totals: { create: rowCount, update: 0 },
      });
      harness.db.killAfterTx = killAfterTx;
      return harness;
    }

    it('resumes a killed run and accumulates the counts of both runs', async () => {
      const harness = crashedHarness(6, 1);

      await withEnv({ IMPORT_UNDO_BATCH_SIZE: '2' }, async () => {
        await harness.service.undoJob(JOB_ID);

        expect(harness.db.job.status).toBe(ImportJobStatus.UNDOING);
        expect(harness.db.deletedEntityIds).toHaveLength(2);
        expect(harness.undoWorker()).toMatchObject({
          processed_rows: 2,
          deleted_rows: 2,
          cursor: '2',
        });

        harness.db.killAfterTx = null;
        expireUndoClaim(harness);
        const resumed = await harness.service.resumeStaleUndoJob(
          TENANT_ID,
          JOB_ID,
        );

        expect(resumed).toBe(true);
      });

      expect(harness.db.job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.db.deletedEntityIds).toHaveLength(6);
      expect(harness.db.job.worker_recovery_seq).toBe(1);
      expect(harness.undoOutcome()).toMatchObject({
        status: 'UNDONE',
        deleted: 6,
        restored: 0,
        blocked: 0,
      });
      expect(harness.undoWorker()).toBeNull();
      const jobAudits = harness.db.audits.filter(
        (entry) => entry.entity_type === 'ImportJob',
      );
      expect(jobAudits).toHaveLength(1);
    });

    it('reclaims a stale undo claim from the recovery cron', async () => {
      const harness = crashedHarness(4, 1);

      await withEnv({ IMPORT_UNDO_BATCH_SIZE: '2' }, async () => {
        await harness.service.undoJob(JOB_ID);
        expect(harness.db.job.status).toBe(ImportJobStatus.UNDOING);

        harness.db.killAfterTx = null;
        expireUndoClaim(harness);
        const recovered = await harness.service.recoverStaleUndoJobs();

        expect(recovered).toBe(true);
      });

      expect(harness.db.job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.db.deletedEntityIds).toHaveLength(4);
    });

    it('leaves a fresh claim alone during recovery', async () => {
      const harness = createHarness({
        rows: [makeRow(1, ImportRowAction.CREATE, 'cust-1')],
      });
      harness.cloudTasks.isEnabled.mockReturnValue(true);
      await withEnv({ CLOUD_TASKS_TARGET_BASE_URL: 'https://api.example.test' }, () =>
        harness.service.undoJobHttp(JOB_ID),
      );
      expect(harness.db.job.status).toBe(ImportJobStatus.UNDOING);

      const resumed = await harness.service.resumeStaleUndoJob(TENANT_ID, JOB_ID);

      expect(resumed).toBe(false);
      expect(harness.db.job.worker_recovery_seq).toBe(0);
      expect(harness.cloudTasks.enqueueImportWorker).toHaveBeenCalledTimes(1);
    });

    it('hands the remaining rows to the next worker unit when the row budget runs out', async () => {
      const harness = createHarness({
        rows: Array.from({ length: 12 }, (_, index) =>
          makeRow(index + 1, ImportRowAction.CREATE, `cust-${index + 1}`),
        ),
        totals: { create: 12, update: 0 },
      });
      harness.cloudTasks.isEnabled.mockReturnValue(true);

      const job = await withEnv(
        {
          IMPORT_UNDO_BATCH_SIZE: '2',
          IMPORT_UNDO_UNIT_ROW_BUDGET: '4',
          CLOUD_TASKS_TARGET_BASE_URL: 'https://api.example.test',
        },
        async () => {
          const claimed = await harness.service.undoJobHttp(JOB_ID);
          await harness.service.runUndoWorkerAttempt({
            tenantId: TENANT_ID,
            jobId: JOB_ID,
          });
          return claimed;
        },
      );

      expect(job.httpStatus).toBe(202);
      expect(harness.db.deletedEntityIds).toHaveLength(4);
      expect(harness.db.job.status).toBe(ImportJobStatus.UNDOING);
      expect(harness.undoWorker()?.processed_rows).toBe(4);
      expect(harness.cloudTasks.enqueueImportWorker).toHaveBeenCalledTimes(2);
    });
  });

  describe('large imports', () => {
    const rowCount = Number(process.env.IMPORT_UNDO_LARGE_TEST_ROWS ?? 20_000);

    it(`undoes ${rowCount} created rows without a per-row eligibility query`, async () => {
      const harness = createHarness({
        rows: Array.from({ length: rowCount }, (_, index) =>
          makeRow(index + 1, ImportRowAction.CREATE, `cust-${index + 1}`),
        ),
        totals: { create: rowCount, update: 0 },
      });

      const job = await withEnv(
        {
          IMPORT_UNDO_BATCH_SIZE: '1000',
          IMPORT_UNDO_UNIT_ROW_BUDGET: String(rowCount * 2),
          IMPORT_UNDO_UNIT_BUDGET_MS: '600000',
        },
        () => harness.service.undoJob(JOB_ID),
      );

      expect(job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.db.deletedEntityIds).toHaveLength(rowCount);
      expect(harness.undoOutcome()).toMatchObject({
        deleted: rowCount,
        blocked: 0,
      });
      expect(harness.undoWorker()?.processed_rows).toBeUndefined();
      const invoiceQueries = (harness.prisma as any).invoice.findMany.mock.calls;
      expect(invoiceQueries.length).toBeLessThanOrEqual(rowCount / 1000);
      expect(invoiceQueries[0][0].where.customer_id.in).toHaveLength(1000);
    }, 600_000);
  });

  describe('concurrent claims', () => {
    it('lets exactly one of two simultaneous undo requests claim the job', async () => {
      const harness = createHarness({
        rows: Array.from({ length: 4 }, (_, index) =>
          makeRow(index + 1, ImportRowAction.CREATE, `cust-${index + 1}`),
        ),
        totals: { create: 4, update: 0 },
      });
      harness.cloudTasks.isEnabled.mockReturnValue(true);

      const results = await withEnv(
        { CLOUD_TASKS_TARGET_BASE_URL: 'https://api.example.test' },
        () =>
          Promise.allSettled([
            harness.service.undoJobHttp(JOB_ID),
            harness.service.undoJobHttp(JOB_ID),
          ]),
      );

      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled',
      ) as PromiseFulfilledResult<{ httpStatus: number }>[];
      const rejected = results.filter(
        (result) => result.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0].value.httpStatus).toBe(202);
      expect(rejected).toHaveLength(1);
      expect((rejected[0].reason as { response: { code: string } }).response.code).toMatch(
        /^IMPORT_JOB_(BUSY|CONFLICT)$/,
      );
      expect(harness.cloudTasks.enqueueImportWorker).toHaveBeenCalledTimes(1);
    });
  });

  describe('worker lease', () => {
    /** Claims over HTTP with Cloud Tasks on, so no worker attempt runs inline. */
    async function dispatchOnlyHarness(rowCount: number) {
      const harness = createHarness({
        rows: Array.from({ length: rowCount }, (_, index) =>
          makeRow(index + 1, ImportRowAction.CREATE, `cust-${index + 1}`),
        ),
        totals: { create: rowCount, update: 0 },
      });
      harness.cloudTasks.isEnabled.mockReturnValue(true);
      await withEnv(
        { CLOUD_TASKS_TARGET_BASE_URL: 'https://api.example.test' },
        () => harness.service.undoJobHttp(JOB_ID),
      );
      return harness;
    }

    function replaceLeaseToken(harness: Harness, leaseToken: string): void {
      const options = harness.optionsJson();
      const worker = options.undo_worker as ImportUndoWorkerState;
      harness.db.job.options_json = {
        ...options,
        undo_worker: { ...worker, lease_token: leaseToken },
      };
    }

    function taskIds(harness: Harness): string[] {
      return harness.cloudTasks.enqueueImportWorker.mock.calls.map(
        (call) =>
          deterministicImportWorkerTaskId(
            (call[0] as { taskIdentity: ImportWorkerTaskIdentity }).taskIdentity,
          ),
      );
    }

    it('lets exactly one of two concurrent worker attempts process the rows', async () => {
      const harness = await dispatchOnlyHarness(4);

      await withEnv({ IMPORT_UNDO_BATCH_SIZE: '2' }, () =>
        Promise.all([
          harness.service.runUndoWorkerAttempt({
            tenantId: TENANT_ID,
            jobId: JOB_ID,
          }),
          harness.service.runUndoWorkerAttempt({
            tenantId: TENANT_ID,
            jobId: JOB_ID,
          }),
        ]),
      );

      expect(harness.db.deletedEntityIds).toEqual([
        'cust-1',
        'cust-2',
        'cust-3',
        'cust-4',
      ]);
      expect(harness.db.job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.undoOutcome()).toMatchObject({ deleted: 4, blocked: 0 });
      expect(
        harness.db.audits.filter((entry) => entry.entity_type === 'ImportJob'),
      ).toHaveLength(1);
    });

    it('refuses to steal a live lease from a worker that is still running', async () => {
      const harness = await dispatchOnlyHarness(4);
      const options = harness.optionsJson();
      const worker = options.undo_worker as ImportUndoWorkerState;
      harness.db.job.options_json = {
        ...options,
        undo_worker: {
          ...worker,
          lease_until: new Date(Date.now() + 60_000).toISOString(),
        },
      };

      await harness.service.runUndoWorkerAttempt({
        tenantId: TENANT_ID,
        jobId: JOB_ID,
      });

      expect(harness.db.deletedEntityIds).toHaveLength(0);
      expect(harness.db.job.status).toBe(ImportJobStatus.UNDOING);
      expect(harness.undoWorker()?.lease_token).toBe(worker.lease_token);
    });

    it('writes nothing once another worker has taken the token over', async () => {
      const harness = await dispatchOnlyHarness(4);
      let taken = false;
      harness.db.beforeTransaction = () => {
        if (taken) return;
        taken = true;
        replaceLeaseToken(harness, 'taken-over');
      };

      await withEnv({ IMPORT_UNDO_BATCH_SIZE: '2' }, () =>
        harness.service.runUndoWorkerAttempt({
          tenantId: TENANT_ID,
          jobId: JOB_ID,
        }),
      );

      expect(harness.db.deletedEntityIds).toHaveLength(0);
      expect(harness.db.job.status).toBe(ImportJobStatus.UNDOING);
      expect(harness.undoWorker()).toMatchObject({
        lease_token: 'taken-over',
        processed_rows: 0,
        deleted_rows: 0,
      });
      expect(harness.undoOutcome()).toBeNull();
    });

    it('releases the lease on handoff so the next unit can claim it', async () => {
      const harness = await dispatchOnlyHarness(6);
      const enqueue = { CLOUD_TASKS_TARGET_BASE_URL: 'https://api.example.test' };

      await withEnv(
        { ...enqueue, IMPORT_UNDO_BATCH_SIZE: '2', IMPORT_UNDO_UNIT_ROW_BUDGET: '2' },
        () =>
          harness.service.runUndoWorkerAttempt({
            tenantId: TENANT_ID,
            jobId: JOB_ID,
          }),
      );
      expect(harness.db.deletedEntityIds).toHaveLength(2);
      expect(isUndoLeaseReleased(harness.undoWorker()?.lease_until)).toBe(true);

      await withEnv({ ...enqueue, IMPORT_UNDO_BATCH_SIZE: '2' }, () =>
        harness.service.runUndoWorkerAttempt({
          tenantId: TENANT_ID,
          jobId: JOB_ID,
        }),
      );

      expect(harness.db.deletedEntityIds).toHaveLength(6);
      expect(harness.db.job.status).toBe(ImportJobStatus.UNDONE);
      expect(harness.undoOutcome()).toMatchObject({ deleted: 6, blocked: 0 });
      expect(taskIds(harness)).toHaveLength(2);
      expect(new Set(taskIds(harness)).size).toBe(2);
    });

    it('persists the claim sequence so a re-run dispatches a new task id', async () => {
      const harness = await dispatchOnlyHarness(1);
      expect(harness.db.job.worker_claim_seq).toBe(1);

      harness.db.job.status = ImportJobStatus.PARTIALLY_UNDONE;
      harness.db.job.updatedAt = new Date(
        harness.db.job.updatedAt.getTime() + 1,
      );
      await withEnv(
        { CLOUD_TASKS_TARGET_BASE_URL: 'https://api.example.test' },
        () => harness.service.undoJobHttp(JOB_ID),
      );

      expect(harness.db.job.worker_claim_seq).toBe(2);
      const ids = taskIds(harness);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    });

    it('skips the cron resume when a takeover landed after the stale read', async () => {
      const harness = createHarness({
        rows: Array.from({ length: 4 }, (_, index) =>
          makeRow(index + 1, ImportRowAction.CREATE, `cust-${index + 1}`),
        ),
        totals: { create: 4, update: 0 },
      });
      harness.cloudTasks.isEnabled.mockReturnValue(true);
      harness.db.killAfterTx = 1;
      await withEnv({ IMPORT_UNDO_BATCH_SIZE: '2' }, () =>
        harness.service.undoJob(JOB_ID),
      );
      harness.db.killAfterTx = null;
      expect(harness.db.job.status).toBe(ImportJobStatus.UNDOING);
      expireUndoClaim(harness);
      const claimedToken = harness.undoWorker()?.lease_token;
      const enqueuedBefore = harness.cloudTasks.enqueueImportWorker.mock.calls
        .length;
      (harness.prisma as any).importJob.findFirst.mockResolvedValueOnce({
        ...harness.db.job,
        updatedAt: new Date(harness.db.job.updatedAt.getTime() - 1000),
      });

      const resumed = await withEnv(
        { CLOUD_TASKS_TARGET_BASE_URL: 'https://api.example.test' },
        () => harness.service.resumeStaleUndoJob(TENANT_ID, JOB_ID),
      );

      expect(resumed).toBe(false);
      expect(harness.db.job.worker_recovery_seq).toBe(0);
      expect(harness.undoWorker()?.lease_token).toBe(claimedToken);
      expect(harness.cloudTasks.enqueueImportWorker).toHaveBeenCalledTimes(
        enqueuedBefore,
      );
    });

    it('releases a claimless UNDOING job to PARTIALLY_UNDONE once rows are undone', async () => {
      const harness = createHarness({
        rows: [
          makeRow(1, ImportRowAction.CREATE, 'cust-1'),
          makeRow(2, ImportRowAction.CREATE, 'cust-2'),
        ],
        totals: { create: 2, update: 0 },
        status: ImportJobStatus.UNDOING,
        options: { undo_worker: { lease_token: '', actor_user_id: '' } },
      });
      harness.db.rows[0].undone_at = new Date();

      await harness.service.recoverStaleUndoJobs();

      expect(harness.db.job.status).toBe(ImportJobStatus.PARTIALLY_UNDONE);
    });
  });
});

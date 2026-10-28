import { Test, type TestingModule } from '@nestjs/testing';
import {
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DecisionUseCaseHooksService } from '../decision/decision-use-case-hooks.service.js';
import { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { ImportCloudTasksService } from './import-cloud-tasks.service.js';
import { ImportFileStorageService } from './import-file.storage.js';
import { withApplyPersistedTotalsTransactionClient } from './import-apply-persisted-totals.test-util.js';
import { ImportService } from './import.service.js';

export const TENANT_ID = 'tenant-1';
export const JOB_ID = 'job-1';
export const SOURCE_SYSTEM = 'legacy-crm';
export const ACTOR_DB_ID = 'user-db-id';
export const ACTOR_AUTH_UID = 'user-admin-uid';
export const ACTOR_EMAIL = 'admin@example.com';
export const TRACE_ID = 'trace-123';
export const CREATED_AT = new Date('2026-10-01T08:00:00.000Z');

export type CreateDryRunParams = Parameters<
  ImportService['createDryRunFromUpload']
>[0];

export type MockPrisma = Record<string, any>;

// Model -> delegate methods the import service touches. Keeping this as data avoids a
// hand-written mock object per spec file.
const PRISMA_DELEGATES: Record<string, string[]> = {
  user: ['findUnique'],
  tenantMember: ['findFirst'],
  vendor: ['findFirst', 'findMany'],
  marginRule: ['findMany'],
  brand: ['findMany'],
  financeSettings: ['findFirst'],
  catalogItem: ['findMany', 'findFirst', 'update', 'create'],
  vendorArticle: ['findFirst', 'findMany', 'upsert'],
  catalogPriceHistory: ['create'],
  customer: ['findMany', 'findFirst', 'create', 'update'],
  vehicle: ['findMany', 'findFirst', 'create', 'update', 'updateMany'],
  vehicleParty: ['findMany', 'create'],
  externalIdMapping: ['findMany', 'findFirst', 'create', 'upsert'],
  importJob: ['create', 'findFirst', 'findMany', 'updateMany', 'update'],
  importJobRow: ['findMany', 'update', 'count'],
  auditLog: ['create'],
};

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = { $transaction: jest.fn() };
  for (const [model, methods] of Object.entries(PRISMA_DELEGATES)) {
    prisma[model] = Object.fromEntries(
      methods.map((method) => [method, jest.fn()]),
    );
  }
  return prisma;
}

export interface ImportHarness {
  service: ImportService;
  cloudTasks: {
    isEnabled: jest.Mock;
    enqueueImportWorker: jest.Mock;
  };
  prisma: MockPrisma;
  tenantContext: {
    getTenantId: jest.Mock;
    getAuthenticatedUser: jest.Mock;
  };
  decisionLive: { applyCustomerImportDecisions: jest.Mock };
  decisionHooks: { scheduleCustomerImportDryRunShadows: jest.Mock };
  requestContext: {
    getTraceId: jest.Mock;
    runAsWorker: jest.Mock;
  };
  systemPrisma: {
    withCronJobLock: jest.Mock;
    tenant: { findMany: jest.Mock };
  };
}

function applyDefaults(harness: ImportHarness): void {
  jest.resetAllMocks();
  harness.systemPrisma.withCronJobLock.mockImplementation(
    async (_name: string, fn: () => Promise<void>) => {
      await fn();
      return true;
    },
  );
  harness.requestContext.runAsWorker.mockImplementation(
    async (_tenantId: string, fn: () => Promise<void>) => {
      await fn();
    },
  );
  harness.prisma.importJob.updateMany.mockResolvedValue({ count: 1 });
  harness.prisma.$executeRaw = jest.fn(async () => 0);
  harness.prisma.$transaction.mockImplementation(
    (callback: (tx: MockPrisma) => unknown) =>
      callback(
        withApplyPersistedTotalsTransactionClient(harness.prisma, {
          tenantId: TENANT_ID,
          expectedRows: 1,
        }),
      ),
  );
  harness.tenantContext.getTenantId.mockResolvedValue(TENANT_ID);
  harness.tenantContext.getAuthenticatedUser.mockReturnValue({
    userId: ACTOR_AUTH_UID,
    role: 'ADMIN',
    email: ACTOR_EMAIL,
  });
  harness.requestContext.getTraceId.mockReturnValue(TRACE_ID);
  harness.decisionLive.applyCustomerImportDecisions.mockResolvedValue({
    mode: 'shadow',
  });
  harness.decisionHooks.scheduleCustomerImportDryRunShadows.mockResolvedValue(
    undefined,
  );
  harness.prisma.user.findUnique.mockResolvedValue({ id: ACTOR_DB_ID });
  harness.prisma.tenantMember.findFirst.mockResolvedValue({
    id: 'member-db-id',
  });

  // Dry runs read these collections; an empty tenant is the default fixture.
  for (const [model, method] of [
    ['externalIdMapping', 'findMany'],
    ['customer', 'findMany'],
    ['vehicle', 'findMany'],
    ['marginRule', 'findMany'],
    ['brand', 'findMany'],
    ['catalogItem', 'findMany'],
    ['vendorArticle', 'findMany'],
    ['importJobRow', 'findMany'],
  ] as const) {
    harness.prisma[model][method].mockResolvedValue([]);
  }
  // setOwnerInTx: vehicle row lock, empty OWNER timeline, a created OWNER row.
  harness.prisma.vehicle.updateMany.mockResolvedValue({ count: 1 });
  harness.prisma.vehicleParty.findMany.mockResolvedValue([]);
  harness.prisma.vehicleParty.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'party-new',
      ...data,
    }),
  );
  harness.prisma.customer.create.mockResolvedValue({
    id: 'cust-new',
    type: 'PRIVATE',
    first_name: 'Test',
    last_name: 'User',
    email: null,
    phone: null,
    vat_id: null,
    address_street: null,
    address_zip: null,
    address_city: null,
    address_country: 'AT',
  });
  harness.prisma.importJob.create.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      id: JOB_ID,
      createdAt: CREATED_AT,
      appliedAt: null,
    }),
  );
}

/**
 * Registers a beforeEach that builds a fresh ImportService over mocked collaborators.
 * Call it inside a describe block. The returned object is filled in before each test.
 */
export function setupImportHarness(): ImportHarness {
  const cloudTasks = {
    isEnabled: jest.fn().mockReturnValue(false),
    enqueueImportWorker: jest.fn(),
  };

  const harness: ImportHarness = {
    service: undefined as unknown as ImportService,
    cloudTasks,
    prisma: createMockPrisma(),
    tenantContext: { getTenantId: jest.fn(), getAuthenticatedUser: jest.fn() },
    decisionLive: { applyCustomerImportDecisions: jest.fn() },
    decisionHooks: { scheduleCustomerImportDryRunShadows: jest.fn() },
    requestContext: {
      getTraceId: jest.fn(),
      runAsWorker: jest.fn(
        async (_tenantId: string, fn: () => Promise<void>) => {
          await fn();
        },
      ),
    },
    systemPrisma: {
      withCronJobLock: jest.fn(
        async (_name: string, fn: () => Promise<void>) => {
          await fn();
          return true;
        },
      ),
      tenant: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    },
  };

  beforeEach(async () => {
    applyDefaults(harness);
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ImportService,
        { provide: PrismaService, useValue: harness.prisma },
        { provide: TenantContextService, useValue: harness.tenantContext },
        {
          provide: DecisionUseCaseHooksService,
          useValue: harness.decisionHooks,
        },
        {
          provide: DecisionLiveApplyService,
          useValue: harness.decisionLive,
        },
        { provide: RequestContextService, useValue: harness.requestContext },
        { provide: SystemPrismaService, useValue: harness.systemPrisma },
        {
          provide: ImportFileStorageService,
          useValue: {
            storeUpload: jest.fn(),
            readBytes: jest.fn(),
            openReadStream: jest.fn(),
            deleteUpload: jest.fn(),
          },
        },
        { provide: ImportCloudTasksService, useValue: cloudTasks },
      ],
    }).compile();
    harness.service = moduleRef.get(ImportService);
  });

  return harness;
}

/** Multer-like upload. Omit `originalname` to exercise the default file name. */
export function csvUpload(
  text: string,
  originalname?: string,
): Express.Multer.File {
  const buffer = Buffer.from(text, 'utf8');
  return {
    buffer,
    originalname,
    size: buffer.length,
  } as unknown as Express.Multer.File;
}

export function dryRunParams(
  entityType: ImportEntityType,
  text: string,
  overrides: Partial<CreateDryRunParams> = {},
): CreateDryRunParams {
  return {
    file: csvUpload(text),
    entityType,
    sourceSystem: SOURCE_SYSTEM,
    mappingJson: {},
    optionsJson: {},
    ...overrides,
  };
}

export function importJobRecord(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    entity_type: ImportEntityType.CUSTOMER,
    source_system: SOURCE_SYSTEM,
    file_name: 'import.csv',
    file_sha256: 'sha-fixture',
    status: ImportJobStatus.DRY_RUN_DONE,
    mapping_json: {},
    options_json: {},
    totals_json: { rows: 0, create: 0, update: 0, skip: 0, error: 0 },
    created_by: ACTOR_DB_ID,
    createdAt: CREATED_AT,
    appliedAt: null,
    ...overrides,
  };
}

export function jobRowRecord(
  overrides: Record<string, unknown> & { row_no: number; action: string },
): Record<string, unknown> {
  return {
    tenant_id: TENANT_ID,
    import_job_id: JOB_ID,
    external_id: null,
    entity_id: null,
    normalized_json: {},
    errors_json: null,
    warnings_json: null,
    ...overrides,
  };
}

function assignRowAction(
  row: Record<string, unknown>,
  rowNo: number | undefined,
  action: ImportRowAction | undefined,
  rowActions: Map<number, ImportRowAction>,
): void {
  if (!action || typeof rowNo !== 'number') return;
  row.action = action;
  rowActions.set(rowNo, action);
}

function patchApplyRow(
  rows: Array<Record<string, unknown>>,
  rowActions: Map<number, ImportRowAction>,
  args: {
    where?: {
      row_no?: number;
      tenant_id_import_job_id_row_no?: { row_no?: number };
    };
    data?: { action?: ImportRowAction; errors_json?: unknown };
  },
): Record<string, unknown> {
  const rowNo =
    args.where?.tenant_id_import_job_id_row_no?.row_no ?? args.where?.row_no;
  const row = rows.find((item) => item.row_no === rowNo);
  if (!row || !args.data) return row ?? {};
  assignRowAction(row, rowNo, args.data.action, rowActions);
  if ('errors_json' in args.data) row.errors_json = args.data.errors_json;
  return row;
}

function applySeqOf(row: Record<string, unknown>): number {
  return typeof row.apply_seq === 'number' ? row.apply_seq : 0;
}

function rowsMatchingApplyQuery(
  rows: Array<Record<string, unknown>>,
  where: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const action = where.action;
  const seq = where.apply_seq;
  const rowNo = where.row_no;
  const minSeq =
    seq && typeof seq === 'object' && 'gt' in seq ? Number(seq.gt) : null;
  const wanted =
    rowNo && typeof rowNo === 'object' && 'in' in rowNo
      ? new Set(rowNo.in as number[])
      : null;
  return rows.filter((row) => {
    if (action && row.action !== action) return false;
    if (minSeq !== null && applySeqOf(row) <= minSeq) return false;
    if (wanted && !wanted.has(row.row_no as number)) return false;
    return true;
  });
}

/** Wires the mocks so applyJob loads a job, locks it, and runs the worker inline. */
export function arrangeApply(
  harness: ImportHarness,
  job: Record<string, unknown>,
  rows: Array<Record<string, unknown>>,
): void {
  const { prisma } = harness;
  const totals = (job.totals_json ?? {}) as { rows?: number };
  const expectedRows = totals.rows ?? rows.length;
  const totalsJson = {
    ...((job.totals_json ?? {}) as Record<string, unknown>),
  };
  if (!totalsJson.rows) totalsJson.rows = rows.length;
  const state: {
    job: Record<string, unknown>;
    rows: Array<Record<string, unknown>>;
  } = {
    job: { ...job, totals_json: totalsJson },
    rows: rows.map((row, index) => ({
      apply_seq: index + 1,
      ...row,
    })),
  };
  const rowActions = new Map<number, ImportRowAction>();
  state.rows.forEach((row, index) => {
    const rowNo = (row.row_no as number | undefined) ?? index + 1;
    row.row_no = rowNo;
    rowActions.set(rowNo, row.action as ImportRowAction);
  });
  prisma.$executeRaw = jest.fn(async () => 0);
  prisma.$transaction.mockImplementation(
    (callback: (tx: MockPrisma) => unknown) =>
      callback(
        withApplyPersistedTotalsTransactionClient(prisma, {
          tenantId: TENANT_ID,
          expectedRows,
          actionsByRow: rowActions,
        }),
      ),
  );
  prisma.importJob.findFirst.mockImplementation(async () => state.job);
  prisma.importJob.updateMany.mockImplementation(
    async ({ data }: { data?: Record<string, unknown> }) => {
      if (data) {
        state.job = {
          ...state.job,
          ...data,
          status: data.status ?? state.job.status,
          options_json: data.options_json ?? state.job.options_json,
          totals_json: data.totals_json ?? state.job.totals_json,
          appliedAt:
            data.appliedAt === undefined ? state.job.appliedAt : data.appliedAt,
        };
      }
      return { count: 1 };
    },
  );
  prisma.importJobRow.findMany.mockImplementation(
    async (args?: { where?: Record<string, unknown>; take?: number }) => {
      const matched = rowsMatchingApplyQuery(state.rows, args?.where ?? {});
      const sorted = [...matched].sort(
        (left, right) => applySeqOf(left) - applySeqOf(right),
      );
      return sorted.slice(0, args?.take ?? sorted.length);
    },
  );
  prisma.importJobRow.findFirst = jest.fn(async () => {
    const withSeq = state.rows.filter((row) => row.apply_seq != null);
    return (
      [...withSeq].sort((left, right) => applySeqOf(right) - applySeqOf(left))[0] ??
      null
    );
  });
  prisma.importJobRow.count.mockImplementation(
    async (args?: { where?: { action?: ImportRowAction } }) => {
      const action = args?.where?.action;
      if (!action) return state.rows.length;
      return state.rows.filter((row) => row.action === action).length;
    },
  );
  prisma.importJobRow.update.mockImplementation(
    async (args: {
      where?: {
        row_no?: number;
        tenant_id_import_job_id_row_no?: { row_no?: number };
      };
      data?: { action?: ImportRowAction; errors_json?: unknown };
    }) => patchApplyRow(state.rows, rowActions, args),
  );
  prisma.auditLog.create.mockResolvedValue({});
  prisma.importJob.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => {
      state.job = {
        ...state.job,
        ...data,
        status: data.status ?? state.job.status,
        totals_json: data.totals_json ?? state.job.totals_json,
        appliedAt: data.appliedAt ?? state.job.appliedAt ?? null,
      };
      return state.job;
    },
  );
}

import { Test, type TestingModule } from '@nestjs/testing';
import { ImportEntityType, ImportJobStatus } from '@prisma/client';
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

/** Wires the mocks so applyJob can load a job and its rows and pass the status lock. */
export function arrangeApply(
  harness: ImportHarness,
  job: Record<string, unknown>,
  rows: Array<Record<string, unknown>>,
): void {
  const { prisma } = harness;
  prisma.importJob.findFirst.mockResolvedValue(job);
  prisma.importJob.updateMany.mockResolvedValue({ count: 1 });
  prisma.importJobRow.findMany.mockResolvedValue(rows);
  prisma.importJobRow.update.mockResolvedValue({});
  prisma.auditLog.create.mockResolvedValue({});
  prisma.importJob.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => ({
      ...job,
      status: data.status,
      totals_json: data.totals_json,
      appliedAt: data.appliedAt ?? null,
    }),
  );
}

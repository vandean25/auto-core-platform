import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildAuditChangeSet,
  normalizeAuditValue,
} from '../audit/audit-diff.util.js';
import { redactAuditSecrets } from '../audit/audit-redaction.util.js';
import {
  PUBLIC_ESTIMATE_APPROVAL_ROLE,
  TenantContextStorage,
  type RequestMeta,
} from '../common/services/tenant-context.storage.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';
import { resolvePrismaModelDelegate } from './prisma-delegate.js';
import { PrismaTransactionContext } from './prisma-transaction-context.js';
import { SideEffectGuard } from '../dry-run/side-effect-guard.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import { runWithDeferredVehicleMediaPurges } from '../vehicle-stock/vehicle-media/vehicle-media-purge.extension.js';
import { runWithDeferredDashboardRealtimeEmits } from './prisma-dashboard-realtime.extension.js';

const logger = new Logger('PrismaAuditExtension');

type PrismaModelDelegate = ReturnType<typeof resolvePrismaModelDelegate>;

export type PrismaQueryArgs = {
  where?: Record<string, unknown>;
  [key: string]: unknown;
};

export type PrismaQueryFn = (args: PrismaQueryArgs) => Promise<unknown>;

export type AuditLogDelegate = {
  create?: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  createMany?: (args: { data: Record<string, unknown>[] }) => Promise<unknown>;
};

export interface AuditInterceptorContext {
  extensionContext?: unknown;
  queryContext?: unknown;
  model: string;
  args: PrismaQueryArgs;
  query: PrismaQueryFn;
}

export interface AuditActorContext {
  tenantId: string;
  user: AuthenticatedUser;
  requestMeta?: RequestMeta;
}

interface AuditRecordPayload {
  model: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  before: unknown;
  after: unknown;
  diff: unknown;
  changedFields: string[];
  redactedFields: string[];
}

interface AuditBatchContext {
  actor: AuditActorContext;
  model: string;
  auditLogDelegate?: AuditLogDelegate;
}

interface PreparedSingleContext {
  actor: AuditActorContext;
  auditLogDelegate?: AuditLogDelegate;
  beforeRaw: unknown;
}

interface PreparedBatchContext {
  batchCtx: AuditBatchContext;
  modelDelegate?: PrismaModelDelegate;
  beforeRows: unknown[];
  result: { count: number };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isAuditLogDelegate(value: unknown): value is AuditLogDelegate {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const delegate = value as AuditLogDelegate;
  return (
    typeof delegate.create === 'function' ||
    typeof delegate.createMany === 'function'
  );
}

/**
 * Tenant-scoped business models audited on single-row and batch update and delete.
 * Internal technical models (AuditLog) and global models (Tenant, User, PlatformAdmin) are excluded.
 */
export const AUDITED_MODELS = new Set([
  'Customer',
  'Vendor',
  'Vehicle',
  'CatalogItem',
  'PurchaseOrder',
  'PurchaseOrderItem',
  'PurchaseInvoice',
  'PurchaseInvoiceItem',
  'PurchaseInvoiceLine',
  'SalesOrder',
  'SalesOrderItem',
  'Invoice',
  'InvoiceItem',
  'WorkshopOrder',
  'WorkshopCheckIn',
  'WorkshopEstimate',
  'WorkshopEstimateVersion',
  'WorkshopEstimateOverrun',
  'WorkshopTask',
  'WorkshopTaskLineItem',
  'WorkshopMedia',
  'LaborEntry',
  'Bay',
  'Employee',
  'RevenueGroup',
  'StorageLocation',
  'Brand',
  'FinanceSettings',
  'LaborCategory',
  'LaborRate',
  'TenantMember',
  'VehiclePurchase',
  'VehicleSale',
  'VehicleLedgerEntry',
  'VehicleMedia',
  'VehicleInspectionRecord',
  'PickerlContactLog',
  'WorkshopOpeningHour',
  'WorkshopHoliday',
  'LegalEntity',
  'Site',
  'SiteMembership',
  'CatalogProviderSettings',
  'CatalogOemConcern',
  'VehicleMakeAlias',
  'EmployeeLeaveBalance',
  'EmployeeWorkSchedule',
  'LeaveRequest',
  'PartsReservation',
  'PartsRequisition',
  'PartsRequisitionLine',
  'LoanerVehicle',
  'LoanerBooking',
]);

function extractEntityId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as { id?: unknown };
  if (typeof candidate.id === 'string' || typeof candidate.id === 'number') {
    return String(candidate.id);
  }

  return undefined;
}

function resolveActorType(
  user?: AuthenticatedUser,
  requestMeta?: RequestMeta,
): 'USER' | 'SYSTEM' | 'MIGRATION' {
  if (
    requestMeta?.source === 'JOB' ||
    user?.role === 'worker' ||
    user?.role === PUBLIC_ESTIMATE_APPROVAL_ROLE
  ) {
    return 'SYSTEM';
  }
  if (requestMeta?.source === 'SCRIPT') {
    return 'MIGRATION';
  }
  return 'USER';
}

function getRequiredTenantContext(): AuditActorContext {
  const user = TenantContextStorage.getUser();
  if (!user?.tenantId) {
    throw new InternalServerErrorException(
      '[AuditExtension] Tenant context not initialised. ' +
        'Ensure JwtAuthGuard and TenantContextMiddleware are applied.',
    );
  }

  return {
    tenantId: user.tenantId,
    user,
    requestMeta: TenantContextStorage.getRequestMeta(),
  };
}

function resolveAuditLogDelegate(
  transactionContext: Record<string, unknown> | undefined,
  thisContext?: Record<string, unknown>,
  ctx?: Record<string, unknown>,
): AuditLogDelegate | undefined {
  for (const context of [transactionContext, thisContext, ctx]) {
    if (!context) {
      continue;
    }
    const candidate =
      context.auditLog ??
      context.AuditLog ??
      asRecord(context.$parent)?.auditLog;
    if (isAuditLogDelegate(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function whereIdAsString(args: PrismaQueryArgs): string {
  const whereId = args.where?.id;
  if (typeof whereId === 'string' || typeof whereId === 'number') {
    return String(whereId);
  }
  return '';
}

function shouldSkipAuditing(model: string): boolean {
  return model === 'AuditLog' || !AUDITED_MODELS.has(model);
}

function isAuditInterceptorContext(
  value: unknown,
): value is AuditInterceptorContext {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return 'model' in obj && 'args' in obj && 'query' in obj;
}

function normalizeInterceptorContext(
  thisArg: unknown,
  ctxOrOptions: unknown,
  rest: unknown[],
): AuditInterceptorContext {
  if (isAuditInterceptorContext(ctxOrOptions)) {
    return {
      extensionContext: ctxOrOptions.extensionContext ?? thisArg,
      queryContext:
        ctxOrOptions.queryContext ?? ctxOrOptions.extensionContext ?? thisArg,
      model: ctxOrOptions.model,
      args: ctxOrOptions.args,
      query: ctxOrOptions.query,
    };
  }

  return {
    extensionContext: thisArg,
    queryContext: ctxOrOptions,
    model: rest[0] as string,
    args: rest[1] as PrismaQueryArgs,
    query: rest[2] as PrismaQueryFn,
  };
}

function getExtensionRecord(extensionThis: unknown): Record<string, unknown> {
  const extCtx = Prisma.getExtensionContext(extensionThis);
  if (extCtx && typeof extCtx === 'object') {
    return extCtx;
  }
  return asRecord(extensionThis) ?? {};
}

function resolveDelegates(
  queryContext: unknown,
  extensionThis: unknown,
  model: string,
): {
  modelDelegate?: PrismaModelDelegate;
  auditLogDelegate?: AuditLogDelegate;
} {
  const extensionContext = getExtensionRecord(extensionThis);
  const queryCtx = asRecord(queryContext) ?? {};
  // Snapshot reads and audit-log writes belong to the transaction that performs
  // the write. The client captured at extension definition runs outside it:
  // snapshots would return the stale committed row (emptying every diff), and
  // the audit insert would take a second pooled connection while the
  // transaction holds its own — exhausting the pool under parallel writes and
  // committing audit rows even when the transaction rolls back.
  const transactionCtx =
    asRecord(PrismaTransactionContext.getClient()) ??
    asRecord(DryRunStorage.getTransactionClient());
  const modelDelegate =
    (transactionCtx
      ? resolvePrismaModelDelegate(transactionCtx, model)
      : undefined) ??
    resolvePrismaModelDelegate(extensionContext, model) ??
    resolvePrismaModelDelegate(queryCtx, model);
  const auditLogDelegate = resolveAuditLogDelegate(
    transactionCtx,
    extensionContext,
    queryCtx,
  );

  return { modelDelegate, auditLogDelegate };
}

function resolveEntityId(
  primary: unknown,
  fallback: unknown,
  args: PrismaQueryArgs,
): string {
  return (
    extractEntityId(primary) ??
    extractEntityId(fallback) ??
    whereIdAsString(args)
  );
}

const PRISMA_SCALAR_FILTER_KEYS = new Set([
  'equals',
  'in',
  'notIn',
  'lt',
  'lte',
  'gt',
  'gte',
  'contains',
  'startsWith',
  'endsWith',
  'mode',
  'not',
]);

const PRISMA_RELATION_FILTER_KEYS = new Set([
  'some',
  'every',
  'none',
  'is',
  'isNot',
]);

const PRISMA_LOGICAL_FILTER_KEYS = new Set(['AND', 'OR', 'NOT']);

function isPlainWhereRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  if (value instanceof Date) {
    return false;
  }
  if (Prisma.Decimal.isDecimal(value)) {
    return false;
  }
  const prototype: object | null = Object.getPrototypeOf(value) as
    object | null;
  return prototype === null || prototype === Object.prototype;
}

function isScalarWhereValue(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function looksLikeCompoundUniqueFilter(
  key: string,
  value: Record<string, unknown>,
): boolean {
  if (!key.includes('_') || key.startsWith('$')) {
    return false;
  }
  const innerKeys = Object.keys(value);
  if (innerKeys.length === 0) {
    return false;
  }
  return innerKeys.every((innerKey) => {
    if (innerKey.startsWith('$')) {
      return false;
    }
    if (PRISMA_SCALAR_FILTER_KEYS.has(innerKey)) {
      return false;
    }
    if (PRISMA_RELATION_FILTER_KEYS.has(innerKey)) {
      return false;
    }
    return isScalarWhereValue(value[innerKey]);
  });
}

/** @internal Exported for unit tests. */
export function normalizeWhereForFindFirst(
  where: Record<string, unknown>,
): Record<string, unknown> | null {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(where)) {
    if (PRISMA_LOGICAL_FILTER_KEYS.has(key)) {
      normalized[key] = value;
      continue;
    }
    if (
      isPlainWhereRecord(value) &&
      looksLikeCompoundUniqueFilter(key, value)
    ) {
      Object.assign(normalized, value);
      continue;
    }
    normalized[key] = value;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

async function fetchBeforeSnapshot(
  modelDelegate: PrismaModelDelegate,
  model: string,
  where?: Record<string, unknown>,
): Promise<unknown> {
  if (typeof modelDelegate?.findFirst !== 'function' || !where) {
    return undefined;
  }
  try {
    const normalizedWhere = normalizeWhereForFindFirst(where);
    if (!normalizedWhere) {
      return undefined;
    }
    return await modelDelegate.findFirst({ where: normalizedWhere });
  } catch (error) {
    // Composite unique keys (e.g. tenant_id_code) are valid for update/delete
    // but rejected by findFirst — proceed without a before snapshot.
    logger.debug(
      `[AuditExtension] Failed to fetch before snapshot for ${model}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function buildAuditLogData(
  actor: AuditActorContext,
  payload: AuditRecordPayload,
): Record<string, unknown> {
  return {
    tenant_id: actor.tenantId,
    entity_type: payload.model,
    entity_id: payload.entityId,
    action: payload.action,
    actor_user_id: actor.user.userId ?? null,
    actor_email: actor.user.email ?? null,
    actor_role: actor.user.role ?? null,
    actor_type: resolveActorType(actor.user, actor.requestMeta),
    request_id:
      actor.requestMeta?.auditCorrelationId ??
      actor.requestMeta?.requestId ??
      null,
    source: actor.requestMeta?.source ?? 'API',
    ip_address: actor.requestMeta?.ip ?? null,
    user_agent: actor.requestMeta?.userAgent ?? null,
    before: payload.before,
    after: payload.after,
    diff: payload.diff,
    changed_fields: payload.changedFields,
    redacted_fields: payload.redactedFields,
  };
}

/**
 * Same audit-log row the Prisma extension inserts. Returns undefined when an
 * update has no business diff, so callers do not write an empty history row.
 * SystemPrisma writes use this instead of copying the column list.
 */
export function buildAuditLogCreateData(input: {
  actor: AuditActorContext;
  model: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE';
  before: unknown;
  after: unknown;
}): Record<string, unknown> | undefined {
  const payload =
    input.action === 'CREATE'
      ? createCreateRecord(input.model, input.entityId, input.after)
      : createUpdateRecord(
          input.model,
          input.entityId,
          input.before,
          input.after,
        );
  if (!isMeaningfulAuditRecord(payload)) {
    return undefined;
  }
  return buildAuditLogData(input.actor, payload);
}

const BOOKKEEPING_FIELDS = new Set(['updatedAt']);

/** Skip when the write itself is empty ({}) or touches nothing but updatedAt. */
function isNoOpUpdateData(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  const keys = Object.keys(data);
  return keys.length === 0 || keys.every((key) => BOOKKEEPING_FIELDS.has(key));
}

/**
 * An UPDATE whose diff only touches bookkeeping columns is not history.
 * This is the last line of defence for every audited update path: even when
 * the write itself names business columns, the row may end up unchanged
 * (for example a main-contact sync that re-sets the same customer).
 */
function hasMeaningfulChanges(changedFields: string[]): boolean {
  return changedFields.some((field) => !BOOKKEEPING_FIELDS.has(field));
}

function isMeaningfulAuditRecord(payload: AuditRecordPayload): boolean {
  return (
    payload.action !== 'UPDATE' || hasMeaningfulChanges(payload.changedFields)
  );
}

function recordDryRunChange(payload: AuditRecordPayload): void {
  const collector = DryRunStorage.getCollector();
  if (collector && payload.entityId) {
    const op =
      payload.action === 'DELETE'
        ? 'delete'
        : payload.action === 'CREATE'
          ? 'create'
          : 'update';
    collector.recordChange({
      entity: payload.model,
      id: payload.entityId,
      op,
    });
  }
}

async function writeAuditLog(
  delegate: AuditLogDelegate | undefined,
  actor: AuditActorContext,
  payload: AuditRecordPayload,
): Promise<void> {
  if (!isMeaningfulAuditRecord(payload)) {
    return;
  }

  if (SideEffectGuard.isDryRun()) {
    recordDryRunChange(payload);
    return;
  }

  if (typeof delegate?.create === 'function') {
    await delegate.create({
      data: buildAuditLogData(actor, payload),
    });
  }
}

// Keeps one multi-row INSERT below the PostgreSQL 65k bind-parameter limit
// (audit rows carry several JSON columns).
const AUDIT_LOG_INSERT_CHUNK_SIZE = 500;

async function writeAuditLogBatch(
  delegate: AuditLogDelegate | undefined,
  actor: AuditActorContext,
  payloads: AuditRecordPayload[],
): Promise<void> {
  const meaningful = payloads.filter(isMeaningfulAuditRecord);

  if (SideEffectGuard.isDryRun()) {
    for (const payload of meaningful) {
      recordDryRunChange(payload);
    }
    return;
  }

  const createMany = delegate?.createMany;
  if (typeof createMany !== 'function') {
    return;
  }

  const entries = meaningful.map((payload) =>
    buildAuditLogData(actor, payload),
  );
  if (entries.length === 0) {
    return;
  }

  for (let i = 0; i < entries.length; i += AUDIT_LOG_INSERT_CHUNK_SIZE) {
    await createMany({
      data: entries.slice(i, i + AUDIT_LOG_INSERT_CHUNK_SIZE),
    });
  }
}

function createUpdateRecord(
  model: string,
  entityId: string,
  beforeRaw: unknown,
  afterRaw: unknown,
): AuditRecordPayload {
  const changeSet = buildAuditChangeSet(beforeRaw, afterRaw);
  return {
    model,
    entityId,
    action: 'UPDATE',
    before: changeSet.before,
    after: changeSet.after,
    diff: changeSet.diff,
    changedFields: changeSet.changedFields,
    redactedFields: changeSet.redactedFields,
  };
}

function createDeleteRecord(
  model: string,
  entityId: string,
  beforeRaw: unknown,
): AuditRecordPayload {
  const normalizedBefore = normalizeAuditValue(beforeRaw);
  const redactedBefore = redactAuditSecrets(normalizedBefore);
  return {
    model,
    entityId,
    action: 'DELETE',
    before: redactedBefore.value,
    after: null,
    diff: null,
    changedFields: [],
    redactedFields: redactedBefore.redactedPaths,
  };
}

async function fetchBeforeRows(
  modelDelegate: PrismaModelDelegate,
  where?: Record<string, unknown>,
): Promise<unknown[]> {
  if (typeof modelDelegate?.findMany === 'function' && where) {
    return (await modelDelegate.findMany({ where })) ?? [];
  }
  return [];
}

function extractAffectedIds(beforeRows: unknown[]): string[] {
  return beforeRows
    .map((r) => extractEntityId(r))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}

async function fetchAfterRowsMap(
  modelDelegate: PrismaModelDelegate,
  affectedIds: string[],
): Promise<Map<string, unknown>> {
  const afterMap = new Map<string, unknown>();
  if (
    typeof modelDelegate?.findMany !== 'function' ||
    affectedIds.length === 0
  ) {
    return afterMap;
  }

  const afterRows =
    (await modelDelegate.findMany({
      where: { id: { in: affectedIds } },
    })) ?? [];

  for (const row of afterRows) {
    const id = extractEntityId(row);
    if (id) {
      afterMap.set(id, row);
    }
  }
  return afterMap;
}

function hasAffectedRows(
  result: { count: number } | undefined | null,
  beforeRows: unknown[],
): boolean {
  return Boolean(result && result.count > 0 && beforeRows.length > 0);
}

async function createUpdateManyAuditRecords(
  batchCtx: AuditBatchContext,
  beforeRows: unknown[],
  afterMap: Map<string, unknown>,
): Promise<void> {
  const payloads = beforeRows.map((beforeRow) => {
    const entityId = extractEntityId(beforeRow) ?? '';
    const afterRow = afterMap.get(entityId) ?? beforeRow;
    return createUpdateRecord(batchCtx.model, entityId, beforeRow, afterRow);
  });
  await writeAuditLogBatch(batchCtx.auditLogDelegate, batchCtx.actor, payloads);
}

async function createDeleteManyAuditRecords(
  batchCtx: AuditBatchContext,
  beforeRows: unknown[],
): Promise<void> {
  const payloads = beforeRows.map((row) =>
    createDeleteRecord(batchCtx.model, extractEntityId(row) ?? '', row),
  );
  await writeAuditLogBatch(batchCtx.auditLogDelegate, batchCtx.actor, payloads);
}

function createCreateRecord(
  model: string,
  entityId: string,
  afterRaw: unknown,
): AuditRecordPayload {
  const normalizedAfter = normalizeAuditValue(afterRaw);
  const redactedAfter = redactAuditSecrets(normalizedAfter);
  return {
    model,
    entityId,
    action: 'CREATE',
    before: null,
    after: redactedAfter.value,
    diff: null,
    changedFields: [],
    redactedFields: redactedAfter.redactedPaths,
  };
}

type AuditWriteOperation =
  'update' | 'delete' | 'updateMany' | 'deleteMany' | 'upsert';

type AuditTransactionRunner = <T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
) => Promise<T>;

function hasActiveTransaction(): boolean {
  return Boolean(
    PrismaTransactionContext.getClient() ??
    DryRunStorage.getTransactionClient() ??
    (PrismaTransactionContext.isInBatch() ? true : undefined),
  );
}

function resolveTransactionRunner(
  ctx: AuditInterceptorContext,
): AuditTransactionRunner | undefined {
  for (const candidate of [ctx.queryContext, ctx.extensionContext]) {
    const record = asRecord(candidate);
    if (typeof record?.$transaction === 'function') {
      return (record.$transaction as AuditTransactionRunner).bind(record);
    }
  }
  return undefined;
}

function createTxWriteExecutor(
  tx: Prisma.TransactionClient,
  model: string,
  operation: AuditWriteOperation,
  fallbackQuery: PrismaQueryFn,
): PrismaQueryFn {
  const txRecord = asRecord(tx);
  const txModelDelegate = txRecord
    ? resolvePrismaModelDelegate(txRecord, model)
    : undefined;
  const delegateMethod = asRecord(txModelDelegate)?.[operation];
  if (typeof delegateMethod === 'function') {
    return (args) =>
      (delegateMethod as PrismaQueryFn).call(txModelDelegate, args);
  }
  return fallbackQuery;
}

async function withAuditTransaction(
  ctx: AuditInterceptorContext,
  operation: AuditWriteOperation,
  work: (
    actor: AuditActorContext,
    executeWrite: PrismaQueryFn,
  ) => Promise<unknown>,
): Promise<unknown> {
  if (shouldSkipAuditing(ctx.model)) {
    return ctx.query(ctx.args);
  }

  const actor = getRequiredTenantContext();
  if (hasActiveTransaction() || DryRunStorage.isDryRun()) {
    return work(actor, ctx.query);
  }

  const txRunner = resolveTransactionRunner(ctx);
  if (!txRunner) {
    return work(actor, ctx.query);
  }

  return runWithDeferredVehicleMediaPurges(() =>
    runWithDeferredDashboardRealtimeEmits(() =>
      txRunner((tx) =>
        PrismaTransactionContext.run(tx, () => {
          const executeWrite = createTxWriteExecutor(
            tx,
            ctx.model,
            operation,
            ctx.query,
          );
          return work(actor, executeWrite);
        }),
      ),
    ),
  );
}

async function prepareSingleOperation(
  interceptorCtx: AuditInterceptorContext,
  actor: AuditActorContext,
): Promise<PreparedSingleContext> {
  const { modelDelegate, auditLogDelegate } = resolveDelegates(
    interceptorCtx.queryContext,
    interceptorCtx.extensionContext,
    interceptorCtx.model,
  );

  const beforeRaw = await fetchBeforeSnapshot(
    modelDelegate,
    interceptorCtx.model,
    interceptorCtx.args?.where,
  );

  return { actor, auditLogDelegate, beforeRaw };
}

async function prepareBatchOperation(
  interceptorCtx: AuditInterceptorContext,
  actor: AuditActorContext,
  executeWrite: PrismaQueryFn,
): Promise<PreparedBatchContext | { earlyResult: unknown }> {
  const { modelDelegate, auditLogDelegate } = resolveDelegates(
    interceptorCtx.queryContext,
    interceptorCtx.extensionContext,
    interceptorCtx.model,
  );

  const beforeRows = await fetchBeforeRows(
    modelDelegate,
    interceptorCtx.args?.where,
  );
  const result = (await executeWrite(interceptorCtx.args)) as {
    count: number;
  };

  if (!hasAffectedRows(result, beforeRows)) {
    return { earlyResult: result };
  }

  return {
    batchCtx: {
      actor,
      model: interceptorCtx.model,
      auditLogDelegate,
    },
    modelDelegate,
    beforeRows,
    result,
  };
}

export async function applyAuditUpdate(
  this: unknown,
  ctxOrOptions: unknown,
  ...rest: unknown[]
): Promise<unknown> {
  const ctx = normalizeInterceptorContext(this, ctxOrOptions, rest);
  return withAuditTransaction(ctx, 'update', async (actor, executeWrite) => {
    const prepared = await prepareSingleOperation(ctx, actor);
    const afterRaw = await executeWrite(ctx.args);
    if (isNoOpUpdateData(ctx.args.data)) {
      return afterRaw;
    }
    const entityId = resolveEntityId(afterRaw, prepared.beforeRaw, ctx.args);
    const payload = createUpdateRecord(
      ctx.model,
      entityId,
      prepared.beforeRaw,
      afterRaw,
    );

    await writeAuditLog(prepared.auditLogDelegate, prepared.actor, payload);
    return afterRaw;
  });
}

export async function applyAuditDelete(
  this: unknown,
  ctxOrOptions: unknown,
  ...rest: unknown[]
): Promise<unknown> {
  const ctx = normalizeInterceptorContext(this, ctxOrOptions, rest);
  return withAuditTransaction(ctx, 'delete', async (actor, executeWrite) => {
    const prepared = await prepareSingleOperation(ctx, actor);
    const deletedRaw = await executeWrite(ctx.args);
    const entityId = resolveEntityId(prepared.beforeRaw, deletedRaw, ctx.args);
    const payload = createDeleteRecord(
      ctx.model,
      entityId,
      prepared.beforeRaw ?? deletedRaw,
    );

    await writeAuditLog(prepared.auditLogDelegate, prepared.actor, payload);
    return deletedRaw;
  });
}

export async function applyAuditUpsert(
  this: unknown,
  ctxOrOptions: unknown,
  ...rest: unknown[]
): Promise<unknown> {
  const ctx = normalizeInterceptorContext(this, ctxOrOptions, rest);
  return withAuditTransaction(ctx, 'upsert', async (actor, executeWrite) => {
    const prepared = await prepareSingleOperation(ctx, actor);
    const afterRaw = await executeWrite(ctx.args);
    const entityId = resolveEntityId(afterRaw, prepared.beforeRaw, ctx.args);

    if (prepared.beforeRaw === null) {
      const payload = createCreateRecord(ctx.model, entityId, afterRaw);
      await writeAuditLog(prepared.auditLogDelegate, prepared.actor, payload);
      return afterRaw;
    }

    if (isNoOpUpdateData(ctx.args.update)) {
      return afterRaw;
    }
    const payload = createUpdateRecord(
      ctx.model,
      entityId,
      prepared.beforeRaw ?? {},
      afterRaw,
    );
    await writeAuditLog(prepared.auditLogDelegate, prepared.actor, payload);
    return afterRaw;
  });
}

export async function applyAuditUpdateMany(
  this: unknown,
  ctxOrOptions: unknown,
  ...rest: unknown[]
): Promise<unknown> {
  const ctx = normalizeInterceptorContext(this, ctxOrOptions, rest);
  return withAuditTransaction(
    ctx,
    'updateMany',
    async (actor, executeWrite) => {
      const prepared = await prepareBatchOperation(ctx, actor, executeWrite);
      if ('earlyResult' in prepared) {
        return prepared.earlyResult;
      }

      if (isNoOpUpdateData(ctx.args.data)) {
        return prepared.result;
      }

      const affectedIds = extractAffectedIds(prepared.beforeRows);
      const afterMap = await fetchAfterRowsMap(
        prepared.modelDelegate,
        affectedIds,
      );

      await createUpdateManyAuditRecords(
        prepared.batchCtx,
        prepared.beforeRows,
        afterMap,
      );

      return prepared.result;
    },
  );
}

export async function applyAuditDeleteMany(
  this: unknown,
  ctxOrOptions: unknown,
  ...rest: unknown[]
): Promise<unknown> {
  const ctx = normalizeInterceptorContext(this, ctxOrOptions, rest);
  return withAuditTransaction(
    ctx,
    'deleteMany',
    async (actor, executeWrite) => {
      const prepared = await prepareBatchOperation(ctx, actor, executeWrite);
      if ('earlyResult' in prepared) {
        return prepared.earlyResult;
      }

      await createDeleteManyAuditRecords(
        prepared.batchCtx,
        prepared.beforeRows,
      );

      return prepared.result;
    },
  );
}

/**
 * Creates a Prisma Client Extension that automatically creates `AuditLog` records
 * for single-row and batch `update`, `delete`, `upsert`, `updateMany`, and `deleteMany`
 * operations on audited tenant business models, atomically within a transaction.
 */
export function createAuditExtension() {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      name: 'prisma-audit',
      query: {
        $allModels: {
          update({ model, args, query }) {
            return applyAuditUpdate.call(this, client, model, args, query);
          },
          delete({ model, args, query }) {
            return applyAuditDelete.call(this, client, model, args, query);
          },
          upsert({ model, args, query }) {
            return applyAuditUpsert.call(this, client, model, args, query);
          },
          updateMany({ model, args, query }) {
            return applyAuditUpdateMany.call(this, client, model, args, query);
          },
          deleteMany({ model, args, query }) {
            return applyAuditDeleteMany.call(this, client, model, args, query);
          },
        },
      },
    });
  });
}

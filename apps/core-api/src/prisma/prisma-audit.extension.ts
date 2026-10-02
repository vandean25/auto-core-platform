import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildAuditChangeSet,
  normalizeAuditValue,
} from '../audit/audit-diff.util.js';
import { redactAuditSecrets } from '../audit/audit-redaction.util.js';
import {
  TenantContextStorage,
  type RequestMeta,
} from '../common/services/tenant-context.storage.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';
import { resolvePrismaModelDelegate } from './prisma-delegate.js';

const logger = new Logger('PrismaAuditExtension');

type PrismaModelDelegate = ReturnType<typeof resolvePrismaModelDelegate>;

export type PrismaQueryArgs = {
  where?: Record<string, unknown>;
  [key: string]: unknown;
};

export type PrismaQueryFn = (args: PrismaQueryArgs) => Promise<unknown>;

export type AuditLogDelegate = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
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
  action: 'UPDATE' | 'DELETE';
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
  return typeof (value as AuditLogDelegate).create === 'function';
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
  'VehicleInspectionRecord',
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
  if (requestMeta?.source === 'JOB' || user?.role === 'worker') {
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
  ctx?: Record<string, unknown>,
  thisContext?: Record<string, unknown>,
): AuditLogDelegate | undefined {
  const candidates = [
    ctx?.auditLog,
    ctx?.AuditLog,
    thisContext?.auditLog,
    thisContext?.AuditLog,
    asRecord(ctx?.$parent)?.auditLog,
    asRecord(thisContext?.$parent)?.auditLog,
  ];

  for (const candidate of candidates) {
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
  const modelDelegate =
    resolvePrismaModelDelegate(queryCtx, model) ??
    resolvePrismaModelDelegate(extensionContext, model);
  const auditLogDelegate = resolveAuditLogDelegate(queryCtx, extensionContext);

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
    request_id: actor.requestMeta?.requestId ?? null,
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

async function writeAuditLog(
  delegate: AuditLogDelegate | undefined,
  actor: AuditActorContext,
  payload: AuditRecordPayload,
): Promise<void> {
  if (typeof delegate?.create === 'function') {
    await delegate.create({
      data: buildAuditLogData(actor, payload),
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
  if (typeof batchCtx.auditLogDelegate?.create !== 'function') {
    return;
  }

  for (const beforeRow of beforeRows) {
    const entityId = extractEntityId(beforeRow) ?? '';
    const afterRow = afterMap.get(entityId) ?? beforeRow;
    const payload = createUpdateRecord(
      batchCtx.model,
      entityId,
      beforeRow,
      afterRow,
    );
    await writeAuditLog(batchCtx.auditLogDelegate, batchCtx.actor, payload);
  }
}

async function createDeleteManyAuditRecords(
  batchCtx: AuditBatchContext,
  beforeRows: unknown[],
): Promise<void> {
  if (typeof batchCtx.auditLogDelegate?.create !== 'function') {
    return;
  }

  for (const row of beforeRows) {
    const entityId = extractEntityId(row) ?? '';
    const payload = createDeleteRecord(batchCtx.model, entityId, row);
    await writeAuditLog(batchCtx.auditLogDelegate, batchCtx.actor, payload);
  }
}

async function prepareSingleOperation(
  interceptorCtx: AuditInterceptorContext,
): Promise<PreparedSingleContext | { earlyResult: unknown }> {
  if (shouldSkipAuditing(interceptorCtx.model)) {
    const earlyResult = await interceptorCtx.query(interceptorCtx.args);
    return { earlyResult };
  }

  const actor = getRequiredTenantContext();
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
): Promise<PreparedBatchContext | { earlyResult: unknown }> {
  if (shouldSkipAuditing(interceptorCtx.model)) {
    const earlyResult = await interceptorCtx.query(interceptorCtx.args);
    return { earlyResult };
  }

  const actor = getRequiredTenantContext();
  const { modelDelegate, auditLogDelegate } = resolveDelegates(
    interceptorCtx.queryContext,
    interceptorCtx.extensionContext,
    interceptorCtx.model,
  );

  const beforeRows = await fetchBeforeRows(
    modelDelegate,
    interceptorCtx.args?.where,
  );
  const result = (await interceptorCtx.query(interceptorCtx.args)) as {
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
  const prepared = await prepareSingleOperation(ctx);
  if ('earlyResult' in prepared) {
    return prepared.earlyResult;
  }

  const afterRaw = await ctx.query(ctx.args);
  const entityId = resolveEntityId(afterRaw, prepared.beforeRaw, ctx.args);
  const payload = createUpdateRecord(
    ctx.model,
    entityId,
    prepared.beforeRaw,
    afterRaw,
  );

  await writeAuditLog(prepared.auditLogDelegate, prepared.actor, payload);
  return afterRaw;
}

export async function applyAuditDelete(
  this: unknown,
  ctxOrOptions: unknown,
  ...rest: unknown[]
): Promise<unknown> {
  const ctx = normalizeInterceptorContext(this, ctxOrOptions, rest);
  const prepared = await prepareSingleOperation(ctx);
  if ('earlyResult' in prepared) {
    return prepared.earlyResult;
  }

  const deletedRaw = await ctx.query(ctx.args);
  const entityId = resolveEntityId(prepared.beforeRaw, deletedRaw, ctx.args);
  const payload = createDeleteRecord(
    ctx.model,
    entityId,
    prepared.beforeRaw ?? deletedRaw,
  );

  await writeAuditLog(prepared.auditLogDelegate, prepared.actor, payload);
  return deletedRaw;
}

export async function applyAuditUpdateMany(
  this: unknown,
  ctxOrOptions: unknown,
  ...rest: unknown[]
): Promise<unknown> {
  const ctx = normalizeInterceptorContext(this, ctxOrOptions, rest);
  const prepared = await prepareBatchOperation(ctx);
  if ('earlyResult' in prepared) {
    return prepared.earlyResult;
  }

  const affectedIds = extractAffectedIds(prepared.beforeRows);
  const afterMap = await fetchAfterRowsMap(prepared.modelDelegate, affectedIds);

  await createUpdateManyAuditRecords(
    prepared.batchCtx,
    prepared.beforeRows,
    afterMap,
  );

  return prepared.result;
}

export async function applyAuditDeleteMany(
  this: unknown,
  ctxOrOptions: unknown,
  ...rest: unknown[]
): Promise<unknown> {
  const ctx = normalizeInterceptorContext(this, ctxOrOptions, rest);
  const prepared = await prepareBatchOperation(ctx);
  if ('earlyResult' in prepared) {
    return prepared.earlyResult;
  }

  await createDeleteManyAuditRecords(prepared.batchCtx, prepared.beforeRows);

  return prepared.result;
}

/**
 * Creates a Prisma Client Extension that automatically creates `AuditLog` records
 * for single-row and batch `update`, `delete`, `updateMany`, and `deleteMany` operations
 * on audited tenant business models.
 */
export function createAuditExtension() {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      name: 'prisma-audit',
      query: {
        $allModels: {
          update({ model, args, query }) {
            return applyAuditUpdate.call(
              this,
              client,
              model,
              args,
              query,
            ) as Promise<unknown>;
          },
          delete({ model, args, query }) {
            return applyAuditDelete.call(
              this,
              client,
              model,
              args,
              query,
            ) as Promise<unknown>;
          },
          updateMany({ model, args, query }) {
            return applyAuditUpdateMany.call(
              this,
              client,
              model,
              args,
              query,
            ) as Promise<unknown>;
          },
          deleteMany({ model, args, query }) {
            return applyAuditDeleteMany.call(
              this,
              client,
              model,
              args,
              query,
            ) as Promise<unknown>;
          },
        },
      },
    });
  });
}

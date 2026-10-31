import {
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';

const logger = new Logger('TenantIsolation');

export const ALL_PRISMA_OPERATIONS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'findRaw',
  'aggregateRaw',
] as const;

export type PrismaOperation = (typeof ALL_PRISMA_OPERATIONS)[number];
export type PrismaOperationClassification =
  'scoped' | 'stamped' | 'rejected' | 'composite';

export const OPERATION_CLASSIFICATIONS: Record<
  PrismaOperation,
  PrismaOperationClassification
> = {
  findUnique: 'rejected',
  findUniqueOrThrow: 'rejected',
  findFirst: 'scoped',
  findFirstOrThrow: 'scoped',
  findMany: 'scoped',
  create: 'stamped',
  createMany: 'stamped',
  createManyAndReturn: 'stamped',
  update: 'scoped',
  updateMany: 'scoped',
  updateManyAndReturn: 'scoped',
  upsert: 'composite',
  delete: 'scoped',
  deleteMany: 'scoped',
  count: 'scoped',
  aggregate: 'scoped',
  groupBy: 'scoped',
  findRaw: 'rejected',
  aggregateRaw: 'rejected',
};

/**
 * Models that do NOT carry a tenant_id column and must bypass tenant isolation.
 * These are currently global/shared reference tables.
 */
const GLOBAL_MODELS = new Set([
  'Tenant',
  'User',
  'PlatformAdmin',
  'MasterPart',
  'PartFitment',
  'LocalInventory',
  'LaborFitment',
]);

/**
 * Operations where tenant_id is injected into args.where.
 * Includes aggregate operations (count, aggregate, groupBy) that per-operation
 * handlers would silently miss, leaking cross-tenant data.
 */
const FILTERABLE_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

interface RelationFieldMeta {
  targetModel: string;
}

const MODEL_RELATIONS_MAP = new Map<string, Map<string, RelationFieldMeta>>();

if (Prisma.dmmf?.datamodel?.models) {
  for (const model of Prisma.dmmf.datamodel.models) {
    const relations = new Map<string, RelationFieldMeta>();
    for (const field of model.fields) {
      if (field.kind === 'object') {
        relations.set(field.name, {
          targetModel: field.type,
        });
      }
    }
    MODEL_RELATIONS_MAP.set(model.name, relations);
  }
}

/**
 * Explicit allowlist for nested relation writes on tenant-scoped models where
 * Prisma provides no alternative (e.g. implicit m-n relations without a join model).
 * Every entry must be justified.
 * - 'Vendor.supportedBrands': implicit many-to-many (_VendorBrands) has no Prisma
 *   delegate model; VendorService validates tenant ownership of brandIds prior to write.
 */
export const ALLOWED_NESTED_RELATION_WRITES = new Set<string>([
  'Vendor.supportedBrands',
]);

const RELATION_MUTATION_KEYS = new Set([
  'connect',
  'connectOrCreate',
  'create',
  'createMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'set',
  'disconnect',
]);

function isScalarSetClause(
  record: Record<string, unknown>,
  keys: string[],
): boolean {
  if (keys.length !== 1 || !Object.hasOwn(record, 'set')) {
    return false;
  }
  const setValue = record.set;
  if (typeof setValue !== 'object' || setValue === null) {
    return true;
  }
  if (Array.isArray(setValue)) {
    return setValue.every((item) => typeof item !== 'object' || item === null);
  }
  return false;
}

function isRelationMutation(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.some((key) => RELATION_MUTATION_KEYS.has(key))) {
    return false;
  }
  return !isScalarSetClause(record, keys);
}

function capitalizeFirstLetter(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function resolveTargetModel(
  modelName: string,
  fieldName: string,
): string | null {
  const modelRelations = MODEL_RELATIONS_MAP.get(modelName);
  if (modelRelations?.has(fieldName)) {
    return modelRelations.get(fieldName)!.targetModel;
  }

  const capitalized = capitalizeFirstLetter(fieldName);
  if (MODEL_RELATIONS_MAP.has(capitalized)) {
    return capitalized;
  }

  if (GLOBAL_MODELS.has(capitalized) || GLOBAL_MODELS.has(fieldName)) {
    return GLOBAL_MODELS.has(capitalized) ? capitalized : fieldName;
  }

  return null;
}

function checkGlobalRelationMutations(
  targetModel: string,
  value: Record<string, unknown>,
): void {
  for (const mutKey of RELATION_MUTATION_KEYS) {
    if (Object.hasOwn(value, mutKey)) {
      assertNoTenantScopedNestedWrites(targetModel, value[mutKey]);
    }
  }
}

function checkNestedWriteEntry(
  modelName: string,
  key: string,
  value: unknown,
): void {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (ALLOWED_NESTED_RELATION_WRITES.has(`${modelName}.${key}`)) {
    return;
  }

  if (!isRelationMutation(value)) {
    assertNoTenantScopedNestedWrites(modelName, value);
    return;
  }

  const targetModel = resolveTargetModel(modelName, key);
  if (targetModel && GLOBAL_MODELS.has(targetModel)) {
    checkGlobalRelationMutations(targetModel, value as Record<string, unknown>);
    return;
  }

  const targetDesc = targetModel
    ? `tenant-scoped model '${targetModel}'`
    : 'tenant-scoped model';
  throw new Error(
    `[TenantIsolation] Nested relation write on '${modelName}.${key}' targeting ${targetDesc} is not permitted.`,
  );
}

function assertNoTenantScopedNestedWrites(
  modelName: string,
  data: unknown,
): void {
  if (!data || typeof data !== 'object') {
    return;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      assertNoTenantScopedNestedWrites(modelName, item);
    }
    return;
  }

  const record = data as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    checkNestedWriteEntry(modelName, key, value);
  }
}

/**
 * Returns the current tenant ID from the AsyncLocalStorage context.
 * Throws InternalServerErrorException if no context is set.
 *
 * Reads directly from TenantContextStorage to avoid circular dependency:
 *   PrismaService → TenantContextService → PrismaService
 */
function getCurrentTenantId(): string {
  const user = TenantContextStorage.getUser();
  if (!user?.tenantId) {
    throw new InternalServerErrorException(
      '[TenantIsolation] Tenant context not initialised. ' +
        'Ensure JwtAuthGuard and TenantContextMiddleware are applied.',
    );
  }
  return user.tenantId;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function assertNoTenantIdInUpdateData(
  model: string,
  operation: string,
  data: unknown,
): void {
  if (data && typeof data === 'object' && Object.hasOwn(data, 'tenant_id')) {
    throw new Error(
      `[TenantIsolation] Modifying tenant_id in ${operation} data on model '${model}' is not permitted.`,
    );
  }
}

function validateAndStampCreateData(
  model: string,
  operation: string,
  data: unknown,
  tenantId: string,
): Record<string, unknown> {
  const normalized = normalizeRecord(data);
  if (
    Object.hasOwn(normalized, 'tenant_id') &&
    normalized.tenant_id !== undefined &&
    normalized.tenant_id !== tenantId
  ) {
    const rawTenantId = normalized.tenant_id;
    const tenantIdStr =
      typeof rawTenantId === 'string'
        ? rawTenantId
        : JSON.stringify(rawTenantId);
    throw new Error(
      `[TenantIsolation] Mismatching tenant_id '${tenantIdStr}' in ${operation} on model '${model}'. Expected '${tenantId}'.`,
    );
  }

  return {
    ...normalized,
    tenant_id: tenantId,
  };
}

function stampTenantIntoCreateManyData(
  model: string,
  operation: string,
  data: unknown,
  tenantId: string,
) {
  if (Array.isArray(data)) {
    return data.map((item) =>
      validateAndStampCreateData(model, operation, item, tenantId),
    );
  }

  return validateAndStampCreateData(model, operation, data, tenantId);
}

function injectTenantIntoWhere(
  where: Record<string, unknown> | undefined,
  tenantId: string,
): { scopedWhere: Record<string, unknown>; injected: boolean } {
  const scopedWhere = normalizeRecord(where);
  let injected = false;

  if (Object.hasOwn(scopedWhere, 'tenant_id')) {
    scopedWhere.tenant_id = tenantId;
    injected = true;
  }

  for (const [key, value] of Object.entries(scopedWhere)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }

    const nested = { ...(value as Record<string, unknown>) };
    if (Object.hasOwn(nested, 'tenant_id')) {
      nested.tenant_id = tenantId;
      scopedWhere[key] = nested;
      injected = true;
    }
  }

  return { scopedWhere, injected };
}

function scopeUpsertWhere(
  model: string,
  where: Record<string, unknown> | undefined,
  tenantId: string,
): Record<string, unknown> {
  const { scopedWhere, injected } = injectTenantIntoWhere(where, tenantId);

  if (!injected) {
    throw new Error(
      `[TenantIsolation] upsert() on model '${model}' must use a tenant-scoped unique selector containing tenant_id.`,
    );
  }

  return scopedWhere;
}

function isRecordNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'P2025',
  );
}

function assertOperationAllowed(model: string, operation: string): void {
  if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
    throw new Error(
      `[TenantIsolation] Do not use ${operation}() on model '${model}'. ` +
        'Use findFirst() with an explicit where clause instead. ' +
        'findUnique() bypasses tenant_id injection due to Prisma unique-index type constraints.',
    );
  }

  if (operation === 'findRaw' || operation === 'aggregateRaw') {
    throw new Error(
      `[TenantIsolation] Do not use ${operation}() on model '${model}'. ` +
        'Raw queries bypass tenant isolation.',
    );
  }

  if (!OPERATION_CLASSIFICATIONS[operation as PrismaOperation]) {
    logger.error(
      `[TenantIsolation] Denied unhandled operation '${operation}' on model '${model}'.`,
    );
    throw new Error(
      `[TenantIsolation] Operation '${operation}' on model '${model}' is not permitted by tenant isolation policy.`,
    );
  }
}

async function executeFilterableOperation(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  tenantId: string,
  query: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown> {
  if (operation === 'updateMany' || operation === 'updateManyAndReturn') {
    assertNoTenantIdInUpdateData(model, operation, args.data);
    assertNoTenantScopedNestedWrites(model, args.data);
  }

  args.where = {
    ...normalizeRecord(args.where),
    tenant_id: tenantId,
  };

  return query(args);
}

async function executeUpdateOrDelete(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  tenantId: string,
  query: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown> {
  if (operation === 'update') {
    assertNoTenantIdInUpdateData(model, 'update', args.data);
    assertNoTenantScopedNestedWrites(model, args.data);
  }

  const { scopedWhere, injected } = injectTenantIntoWhere(
    args.where as Record<string, unknown> | undefined,
    tenantId,
  );

  if (Object.keys(scopedWhere).length === 0) {
    throw new Error(
      `[TenantIsolation] ${operation}() on model '${model}' requires a where clause.`,
    );
  }

  if (injected) {
    args.where = scopedWhere;
    return query(args);
  }

  args.where = { ...scopedWhere, tenant_id: tenantId };

  try {
    return await query(args);
  } catch (error) {
    if (!isRecordNotFoundError(error)) {
      throw error;
    }

    throw new NotFoundException(
      `[TenantIsolation] ${model} record not found for current tenant.`,
    );
  }
}

async function executeCreate(
  model: string,
  args: Record<string, unknown>,
  tenantId: string,
  query: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown> {
  assertNoTenantScopedNestedWrites(model, args.data);
  args.data = validateAndStampCreateData(model, 'create', args.data, tenantId);
  return query(args);
}

async function executeCreateMany(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  tenantId: string,
  query: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown> {
  assertNoTenantScopedNestedWrites(model, args.data);
  args.data = stampTenantIntoCreateManyData(
    model,
    operation,
    args.data,
    tenantId,
  );
  return query(args);
}

async function executeUpsert(
  model: string,
  args: Record<string, unknown>,
  tenantId: string,
  query: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown> {
  assertNoTenantIdInUpdateData(model, 'upsert update', args.update);
  assertNoTenantScopedNestedWrites(model, args.create);
  assertNoTenantScopedNestedWrites(model, args.update);

  args.where = scopeUpsertWhere(
    model,
    args.where as Record<string, unknown> | undefined,
    tenantId,
  );
  args.create = validateAndStampCreateData(
    model,
    'create',
    args.create,
    tenantId,
  );

  return query(args);
}

/**
 * The core $allOperations handler logic — extracted for unit testability.
 * Applies tenant isolation rules to a single Prisma operation.
 *
 * `baseClient` is the client captured at extension definition. It is kept in
 * the signature to make the isolation boundary explicit, but the extension
 * must never query through it: it lives outside every active transaction and
 * dry-run context.
 */
export async function applyTenantIsolation(
  this: unknown,
  baseClient: unknown,
  model: string,
  operation: string,
  args: unknown,
  query: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown> {
  const nextArgs = normalizeRecord(args);

  // Pass through for models without a tenant_id column
  if (GLOBAL_MODELS.has(model)) {
    return query(nextArgs);
  }

  assertOperationAllowed(model, operation);

  const tenantId = getCurrentTenantId();

  // Read + bulk-mutation operations: inject into where clause
  if (FILTERABLE_OPERATIONS.has(operation)) {
    return executeFilterableOperation(
      model,
      operation,
      nextArgs,
      tenantId,
      query,
    );
  }

  // Targeted single-row mutations: the tenant is part of the write selector,
  // so the ownership check and the write are one atomic statement.
  if (operation === 'update' || operation === 'delete') {
    return executeUpdateOrDelete(model, operation, nextArgs, tenantId, query);
  }

  // create: stamp tenant_id onto the new record
  if (operation === 'create') {
    return executeCreate(model, nextArgs, tenantId, query);
  }

  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    return executeCreateMany(model, operation, nextArgs, tenantId, query);
  }

  // upsert: tenant_id required in both where (lookup) and create (new row)
  if (operation === 'upsert') {
    return executeUpsert(model, nextArgs, tenantId, query);
  }

  logger.error(
    `[TenantIsolation] Denied unhandled operation '${operation}' on model '${model}'.`,
  );
  throw new Error(
    `[TenantIsolation] Operation '${operation}' on model '${model}' is not permitted by tenant isolation policy.`,
  );
}

/**
 * Creates a Prisma Client Extension that automatically injects tenant_id into
 * every query operation for tenant-scoped models.
 *
 * Security guarantees (per ADR-0013):
 * - findMany, findFirst, count, aggregate, groupBy → where clause scoped
 * - update, delete → where clause scoped (prevents cross-tenant mutation)
 * - create → data stamped with tenant_id
 * - upsert → both where and create stamped
 * - findUnique / findUniqueOrThrow → throws developer error (use findFirst)
 *
 * Application: chain this extension BEFORE the dashboard-realtime extension
 * so that the scoped query result is what triggers realtime events.
 *
 * @see docs/internal/01-ADR/2026-04-15-row-level-multi-tenancy.md
 * @see docs/internal/05-Runbooks/prisma-raw-query-prohibition.md
 */
export function createTenantIsolationExtension() {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      name: 'tenant-isolation',
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            return applyTenantIsolation.call(
              this,
              client,
              model,
              operation,
              args,
              query,
            );
          },
        },
      },
    });
  });
}

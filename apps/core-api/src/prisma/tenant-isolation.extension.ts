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
const MODEL_SCALARS_MAP = new Map<string, Set<string>>();

if (Prisma.dmmf?.datamodel?.models) {
  for (const model of Prisma.dmmf.datamodel.models) {
    const relations = new Map<string, RelationFieldMeta>();
    const scalars = new Set<string>();
    for (const field of model.fields) {
      if (field.kind === 'object') {
        relations.set(field.name, {
          targetModel: field.type,
        });
      } else {
        scalars.add(field.name);
      }
    }
    MODEL_RELATIONS_MAP.set(model.name, relations);
    MODEL_SCALARS_MAP.set(model.name, scalars);
  }
}

/**
 * Nested relations allowlist categorized by isolation mechanism:
 *
 * 1. COMPOSITE_KEY_NESTED_RELATIONS (13 entries):
 *    Child table carries a composite foreign key [tenant_id, <parent_id>] references
 *    [tenant_id, id] of the parent. Tenant isolation is enforced at the database level.
 *
 * 2. SINGLE_KEY_CHILD_TENANT_RELATIONS (6 entries: PurchaseOrder.items, SalesOrder.items,
 *    Invoice.items, CreditNote.items, PurchaseInvoice.lines, PartsRequisition.lines):
 *    Child table carries a tenant_id column, but foreign key to parent is single-column
 *    (<parent_id> references parent.id). Because Prisma nested writes bypass the model
 *    delegate, tenant isolation is enforced by this extension:
 *    - nested create / createMany: automatically stamp current context tenant_id, rejecting
 *      conflicting tenant_id in child payload.
 *    - connect, set, update, updateMany, upsert, delete, deleteMany, disconnect, connectOrCreate:
 *      strictly rejected to prevent attaching or mutating rows across tenants.
 *
 * 3. IMPLICIT_JOIN_NESTED_RELATIONS (Vendor.supportedBrands):
 *    Implicit many-to-many join (_VendorBrands) has no Prisma delegate model and no tenant
 *    column on the join table. Only connect, set, and disconnect are permitted, and all
 *    referenced brand IDs must be verified to belong to the current tenant before execution.
 *    Nested create and update mutations are rejected.
 */
export const COMPOSITE_KEY_NESTED_RELATIONS = new Set<string>([
  'EmployeeWorkSchedule.days',
  'VehicleListing.channels',
  'VehicleListing.photos',
  'WorkshopEstimate.versions',
  'StockTransfer.lines',
  'ImportJob.rows',
  'WorkshopOrder.tasks',
  'WorkshopTask.line_items',
  'TyreMeasurement.wheels',
  'WorkshopInspection.items',
  'InspectionTemplate.items',
  'LegacyDocument.lines',
  'WarrantyClaim.lines',
]);

export const SINGLE_KEY_CHILD_TENANT_RELATIONS = new Set<string>([
  'PurchaseOrder.items',
  'SalesOrder.items',
  'Invoice.items',
  'CreditNote.items',
  'PurchaseInvoice.lines',
  'PartsRequisition.lines',
]);

export const IMPLICIT_JOIN_NESTED_RELATIONS = new Set<string>([
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

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectArray(value: unknown): boolean {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some((item) => typeof item === 'object' && item !== null);
}

function isValidMutationPayload(key: string, payload: unknown): boolean {
  if (key === 'delete' || key === 'disconnect') {
    return (
      payload === true || (typeof payload === 'object' && payload !== null)
    );
  }
  if (key === 'set') {
    return isObjectArray(payload);
  }
  return typeof payload === 'object' && payload !== null;
}

function isRelationMutation(value: unknown): boolean {
  if (!isObjectRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  const mutationKey = keys.find((key) => RELATION_MUTATION_KEYS.has(key));
  if (!mutationKey || isScalarSetClause(value, keys)) {
    return false;
  }
  return isValidMutationPayload(mutationKey, value[mutationKey]);
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

async function checkGlobalRelationMutations(
  targetModel: string,
  value: Record<string, unknown>,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  for (const mutKey of RELATION_MUTATION_KEYS) {
    if (Object.hasOwn(value, mutKey)) {
      await assertNoTenantScopedNestedWrites(
        targetModel,
        value[mutKey],
        tenantId,
        contextClient,
      );
    }
  }
}

async function checkAllowlistedRelationMutation(
  targetModel: string,
  value: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  if (!value || typeof value !== 'object') {
    return;
  }
  const record = value as Record<string, unknown>;
  for (const mutKey of RELATION_MUTATION_KEYS) {
    if (!Object.hasOwn(record, mutKey)) {
      continue;
    }
    const payload = record[mutKey];
    if (!payload || typeof payload !== 'object') {
      continue;
    }
    if (mutKey === 'createMany' && Object.hasOwn(payload, 'data')) {
      await assertNoTenantScopedNestedWrites(
        targetModel,
        (payload as Record<string, unknown>).data,
        tenantId,
        contextClient,
      );
    } else {
      await assertNoTenantScopedNestedWrites(
        targetModel,
        payload,
        tenantId,
        contextClient,
      );
    }
  }
}

function throwNestedRelationWriteError(
  modelName: string,
  key: string,
  targetModel: string | null,
): never {
  const targetDesc = targetModel
    ? `tenant-scoped model '${targetModel}'`
    : 'tenant-scoped model';
  throw new Error(
    `[TenantIsolation] Nested relation write on '${modelName}.${key}' targeting ${targetDesc} is not permitted.`,
  );
}

function extractBrandIds(payload: unknown): number[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => {
        if (item && typeof item === 'object' && 'id' in item) {
          const id = Number((item as Record<string, unknown>).id);
          return isNaN(id) ? null : id;
        }
        return null;
      })
      .filter((id): id is number => id !== null);
  }
  if (payload && typeof payload === 'object' && 'id' in payload) {
    const id = Number((payload as Record<string, unknown>).id);
    return isNaN(id) ? [] : [id];
  }
  return [];
}

function getPresentRelationMutationKeys(
  record: Record<string, unknown>,
): string[] {
  return Object.keys(record).filter((k) => RELATION_MUTATION_KEYS.has(k));
}

async function verifyImplicitJoinBrandOwnership(
  modelName: string,
  key: string,
  brandIds: number[],
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  if (brandIds.length === 0) {
    return;
  }

  const client =
    contextClient &&
    typeof (contextClient as Record<string, unknown>).brand === 'object'
      ? (contextClient as {
          brand: {
            findMany: (args: unknown) => Promise<Array<{ id: number }>>;
          };
        })
      : null;

  if (!client || typeof client.brand?.findMany !== 'function') {
    throw new Error(
      `[TenantIsolation] Cannot verify tenant ownership for nested relation write on '${modelName}.${key}'. No brand query client available.`,
    );
  }

  const matchingBrands = await client.brand.findMany({
    where: {
      id: { in: brandIds },
      tenant_id: tenantId,
    },
    select: { id: true },
  });

  const matchingSet = new Set(matchingBrands.map((b) => b.id));
  const hasUnauthorized = brandIds.some((id) => !matchingSet.has(id));
  if (hasUnauthorized) {
    throw new Error(
      `[TenantIsolation] Nested relation write on '${modelName}.${key}' references brands not belonging to current tenant.`,
    );
  }
}

async function processRelationMutations(
  record: Record<string, unknown>,
  modelName: string,
  key: string,
  targetModel: string,
  handler: (mutKey: string) => Promise<boolean>,
): Promise<void> {
  const mutKeys = getPresentRelationMutationKeys(record);
  for (const mutKey of mutKeys) {
    const handled = await handler(mutKey);
    if (!handled) {
      throwNestedRelationWriteError(modelName, key, targetModel);
    }
  }
}

async function handleImplicitJoinNestedWrite(
  modelName: string,
  key: string,
  record: Record<string, unknown>,
  targetModel: string,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  await processRelationMutations(
    record,
    modelName,
    key,
    targetModel,
    async (mutKey) => {
      if (mutKey === 'connect' || mutKey === 'set' || mutKey === 'disconnect') {
        const brandIds = extractBrandIds(record[mutKey]);
        await verifyImplicitJoinBrandOwnership(
          modelName,
          key,
          brandIds,
          tenantId,
          contextClient,
        );
        return true;
      }
      return false;
    },
  );
}

async function stampAndValidateChildRecord(
  targetModel: string,
  operation: string,
  item: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<Record<string, unknown>> {
  const stamped = validateAndStampCreateData(
    targetModel,
    operation,
    item,
    tenantId,
  );
  await assertNoTenantScopedNestedWrites(
    targetModel,
    stamped,
    tenantId,
    contextClient,
  );
  return stamped;
}

async function stampAndValidateChildPayload(
  targetModel: string,
  operation: string,
  payload: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<unknown> {
  if (Array.isArray(payload)) {
    return Promise.all(
      payload.map((item) =>
        stampAndValidateChildRecord(
          targetModel,
          operation,
          item,
          tenantId,
          contextClient,
        ),
      ),
    );
  }
  if (payload && typeof payload === 'object') {
    return stampAndValidateChildRecord(
      targetModel,
      operation,
      payload,
      tenantId,
      contextClient,
    );
  }
  return payload;
}

async function handleSingleKeyChildTenantWrite(
  modelName: string,
  key: string,
  record: Record<string, unknown>,
  targetModel: string,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  await processRelationMutations(
    record,
    modelName,
    key,
    targetModel,
    async (mutKey) => {
      if (mutKey === 'create') {
        record.create = await stampAndValidateChildPayload(
          targetModel,
          'create',
          record.create,
          tenantId,
          contextClient,
        );
        return true;
      }

      if (mutKey === 'createMany') {
        const payload = record.createMany;
        if (
          payload &&
          typeof payload === 'object' &&
          Object.hasOwn(payload, 'data')
        ) {
          (payload as Record<string, unknown>).data =
            await stampAndValidateChildPayload(
              targetModel,
              'createMany',
              (payload as Record<string, unknown>).data,
              tenantId,
              contextClient,
            );
        }
        return true;
      }

      return false;
    },
  );
}

async function handleAllowlistedNestedWrite(
  relationPath: string,
  modelName: string,
  key: string,
  value: Record<string, unknown>,
  targetModel: string | null | undefined,
  tenantId: string,
  contextClient?: unknown,
): Promise<boolean> {
  if (SINGLE_KEY_CHILD_TENANT_RELATIONS.has(relationPath)) {
    await handleSingleKeyChildTenantWrite(
      modelName,
      key,
      value,
      targetModel ?? key,
      tenantId,
      contextClient,
    );
    return true;
  }

  if (IMPLICIT_JOIN_NESTED_RELATIONS.has(relationPath)) {
    await handleImplicitJoinNestedWrite(
      modelName,
      key,
      value,
      targetModel ?? 'Brand',
      tenantId,
      contextClient,
    );
    return true;
  }

  if (COMPOSITE_KEY_NESTED_RELATIONS.has(relationPath)) {
    if (targetModel) {
      await checkAllowlistedRelationMutation(
        targetModel,
        value,
        tenantId,
        contextClient,
      );
    }
    return true;
  }

  return false;
}

async function checkNestedWriteEntry(
  modelName: string,
  key: string,
  value: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  if (!value || typeof value !== 'object') {
    return;
  }

  if (MODEL_SCALARS_MAP.get(modelName)?.has(key)) {
    return;
  }

  const relationPath = `${modelName}.${key}`;
  const targetModel = resolveTargetModel(modelName, key);

  const handled = await handleAllowlistedNestedWrite(
    relationPath,
    modelName,
    key,
    value as Record<string, unknown>,
    targetModel,
    tenantId,
    contextClient,
  );
  if (handled) {
    return;
  }

  if (!isRelationMutation(value)) {
    await assertNoTenantScopedNestedWrites(
      modelName,
      value,
      tenantId,
      contextClient,
    );
    return;
  }

  const resolvedTarget = targetModel;
  if (resolvedTarget && GLOBAL_MODELS.has(resolvedTarget)) {
    await checkGlobalRelationMutations(
      resolvedTarget,
      value as Record<string, unknown>,
      tenantId,
      contextClient,
    );
    return;
  }

  throwNestedRelationWriteError(modelName, key, resolvedTarget);
}

async function assertNoTenantScopedNestedWrites(
  modelName: string,
  data: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  if (!data || typeof data !== 'object') {
    return;
  }

  if (Array.isArray(data)) {
    for (const item of data) {
      await assertNoTenantScopedNestedWrites(
        modelName,
        item,
        tenantId,
        contextClient,
      );
    }
    return;
  }

  const record = data as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    await checkNestedWriteEntry(modelName, key, value, tenantId, contextClient);
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
    throw new Error(
      `[TenantIsolation] Mismatching tenant_id in ${operation} on model '${model}'.`,
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
  contextClient?: unknown,
): Promise<unknown> {
  if (operation === 'updateMany' || operation === 'updateManyAndReturn') {
    assertNoTenantIdInUpdateData(model, operation, args.data);
    await assertNoTenantScopedNestedWrites(
      model,
      args.data,
      tenantId,
      contextClient,
    );
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
  contextClient?: unknown,
): Promise<unknown> {
  if (operation === 'update') {
    assertNoTenantIdInUpdateData(model, 'update', args.data);
    await assertNoTenantScopedNestedWrites(
      model,
      args.data,
      tenantId,
      contextClient,
    );
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
  contextClient?: unknown,
): Promise<unknown> {
  await assertNoTenantScopedNestedWrites(
    model,
    args.data,
    tenantId,
    contextClient,
  );
  args.data = validateAndStampCreateData(model, 'create', args.data, tenantId);
  return query(args);
}

async function executeCreateMany(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  tenantId: string,
  query: (args: Record<string, unknown>) => Promise<unknown>,
  contextClient?: unknown,
): Promise<unknown> {
  await assertNoTenantScopedNestedWrites(
    model,
    args.data,
    tenantId,
    contextClient,
  );
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
  contextClient?: unknown,
): Promise<unknown> {
  assertNoTenantIdInUpdateData(model, 'upsert update', args.update);
  await assertNoTenantScopedNestedWrites(
    model,
    args.create,
    tenantId,
    contextClient,
  );
  await assertNoTenantScopedNestedWrites(
    model,
    args.update,
    tenantId,
    contextClient,
  );

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

async function dispatchTenantOperation(
  model: string,
  operation: string,
  nextArgs: Record<string, unknown>,
  tenantId: string,
  query: (args: Record<string, unknown>) => Promise<unknown>,
  contextClient: unknown,
): Promise<unknown> {
  if (FILTERABLE_OPERATIONS.has(operation)) {
    return executeFilterableOperation(
      model,
      operation,
      nextArgs,
      tenantId,
      query,
      contextClient,
    );
  }

  if (operation === 'update' || operation === 'delete') {
    return executeUpdateOrDelete(
      model,
      operation,
      nextArgs,
      tenantId,
      query,
      contextClient,
    );
  }

  if (operation === 'create') {
    return executeCreate(model, nextArgs, tenantId, query, contextClient);
  }

  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    return executeCreateMany(
      model,
      operation,
      nextArgs,
      tenantId,
      query,
      contextClient,
    );
  }

  if (operation === 'upsert') {
    return executeUpsert(model, nextArgs, tenantId, query, contextClient);
  }

  logger.error(
    `[TenantIsolation] Denied unhandled operation '${operation}' on model '${model}'.`,
  );
  throw new Error(
    `[TenantIsolation] Operation '${operation}' on model '${model}' is not permitted by tenant isolation policy.`,
  );
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
  const contextClient =
    this && typeof (this as Record<string, unknown>).brand === 'object'
      ? this
      : baseClient;

  return dispatchTenantOperation(
    model,
    operation,
    nextArgs,
    tenantId,
    query,
    contextClient,
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

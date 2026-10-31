import {
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { PrismaTransactionContext } from './prisma-transaction-context.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';

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
 *    [tenant_id, id] of the parent. Prisma populates tenant_id from parent automatically.
 *    Tenant isolation is enforced across all nested operations:
 *    - nested create / createMany: validates child payload (rejects conflicting tenant_id;
 *      omits tenant_id so Prisma schema validator does not reject it as unknown argument;
 *      recurses into nested writes).
 *    - nested connect / set: verifies tenant ownership of referenced IDs before execution.
 *      Cross-tenant references are strictly rejected.
 *    - nested connectOrCreate / upsert: verifies tenant ownership on where clause, validates
 *      create and update payloads.
 *    - nested update / updateMany: asserts update payload cannot mutate tenant_id and recurses.
 *    - delete, deleteMany, disconnect: permitted for unlinking/deletion.
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
 *    column on the join table. Only connect, set, and disconnect with exact { id: <number> }
 *    brand references are permitted, verified against the active transaction or dry-run context.
 *    Non-id selectors, nested create, update, upsert, and connectOrCreate are strictly rejected.
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
  'upsert',
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

function parseBrandReferenceObject(
  modelName: string,
  key: string,
  item: unknown,
): number {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(
      `[TenantIsolation] Nested relation write on '${modelName}.${key}' contains invalid brand reference. Expected an object with numeric id.`,
    );
  }
  const record = item as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 1 || !('id' in record)) {
    throw new Error(
      `[TenantIsolation] Nested relation write on '${modelName}.${key}' contains unsupported brand reference selector. Only exact { id: <number> } is permitted.`,
    );
  }
  const id = record.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    throw new Error(
      `[TenantIsolation] Nested relation write on '${modelName}.${key}' contains invalid brand id. Expected positive integer.`,
    );
  }
  return id;
}

function parseBrandReferenceIds(
  modelName: string,
  key: string,
  payload: unknown,
): number[] {
  if (Array.isArray(payload)) {
    return payload.map((item) =>
      parseBrandReferenceObject(modelName, key, item),
    );
  }

  if (payload && typeof payload === 'object') {
    return [parseBrandReferenceObject(modelName, key, payload)];
  }

  throw new Error(
    `[TenantIsolation] Nested relation write on '${modelName}.${key}' contains invalid brand reference payload.`,
  );
}

function getPresentRelationMutationKeys(
  record: Record<string, unknown>,
): string[] {
  return Object.keys(record).filter((k) => RELATION_MUTATION_KEYS.has(k));
}

function resolveBrandQueryClient(
  modelName: string,
  key: string,
  contextClient?: unknown,
): {
  brand: {
    findMany: (args: unknown) => Promise<Array<{ id: number }>>;
  };
} {
  const transactionCtx =
    PrismaTransactionContext.getClient() ??
    DryRunStorage.getTransactionClient();
  const candidate = transactionCtx ?? contextClient;

  if (
    candidate &&
    typeof candidate === 'object' &&
    'brand' in candidate &&
    typeof (candidate as Record<string, unknown>).brand === 'object'
  ) {
    const brandDelegate = (candidate as Record<string, unknown>).brand;
    if (
      brandDelegate &&
      typeof (brandDelegate as Record<string, unknown>).findMany === 'function'
    ) {
      return candidate as {
        brand: {
          findMany: (args: unknown) => Promise<Array<{ id: number }>>;
        };
      };
    }
  }

  throw new Error(
    `[TenantIsolation] Cannot verify tenant ownership for nested relation write on '${modelName}.${key}'. No brand query client available.`,
  );
}

async function verifyImplicitJoinBrandOwnership(
  modelName: string,
  key: string,
  brandIds: number[],
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  const client = resolveBrandQueryClient(modelName, key, contextClient);

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
        const payload = record[mutKey];
        const brandIds = parseBrandReferenceIds(modelName, key, payload);
        if (brandIds.length === 0) {
          if (mutKey === 'connect') {
            throw new Error(
              `[TenantIsolation] Nested relation write on '${modelName}.${key}' contains empty brand connect payload.`,
            );
          }
          return true;
        }

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

function toRecordArray(payload: unknown): Record<string, unknown>[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }
  const items = Array.isArray(payload) ? payload : [payload];
  const records: Record<string, unknown>[] = [];
  for (const item of items) {
    if (item && typeof item === 'object') {
      records.push(item as Record<string, unknown>);
    }
  }
  return records;
}

function extractSingleId(item: unknown): string | number | undefined {
  if (typeof item === 'string') {
    return item.length > 0 ? item : undefined;
  }
  if (typeof item === 'number') {
    return Number.isInteger(item) ? item : undefined;
  }
  if (item && typeof item === 'object') {
    return extractSingleId((item as Record<string, unknown>).id);
  }
  return undefined;
}

function extractTargetIds(payload: unknown): Array<string | number> {
  if (!payload) {
    return [];
  }
  const items = Array.isArray(payload) ? payload : [payload];
  const ids: Array<string | number> = [];
  for (const item of items) {
    const id = extractSingleId(item);
    if (id !== undefined) {
      ids.push(id);
    }
  }
  return ids;
}

function extractCreateManyData(payload: unknown): unknown {
  if (
    payload &&
    typeof payload === 'object' &&
    Object.hasOwn(payload, 'data')
  ) {
    return (payload as Record<string, unknown>).data;
  }
  return undefined;
}

function getModelDelegate(
  targetModel: string,
  contextClient?: unknown,
):
  | {
      findMany: (
        args: unknown,
      ) => Promise<Array<{ id: unknown; tenant_id?: string }>>;
    }
  | undefined {
  const client =
    PrismaTransactionContext.getClient() ??
    DryRunStorage.getTransactionClient() ??
    contextClient;
  const delegateName =
    targetModel.charAt(0).toLowerCase() + targetModel.slice(1);
  const delegate = client
    ? (client as Record<string, unknown>)[delegateName]
    : undefined;

  if (
    delegate &&
    typeof (delegate as Record<string, unknown>).findMany === 'function'
  ) {
    return delegate as {
      findMany: (
        args: unknown,
      ) => Promise<Array<{ id: unknown; tenant_id?: string }>>;
    };
  }
  return undefined;
}

async function validateCompositeChildRecord(
  targetModel: string,
  operation: string,
  item: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<unknown> {
  if (!item || typeof item !== 'object') {
    return item;
  }
  const child = item as Record<string, unknown>;
  if (Object.hasOwn(child, 'tenant_id')) {
    if (child.tenant_id !== tenantId) {
      throw new Error(
        `[TenantIsolation] Mismatching tenant_id in ${operation} on model '${targetModel}'.`,
      );
    }
    delete child.tenant_id;
  }
  await assertNoTenantScopedNestedWrites(
    targetModel,
    child,
    tenantId,
    contextClient,
  );
  return child;
}

async function validateCompositeChildPayload(
  targetModel: string,
  operation: string,
  payload: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<unknown> {
  if (Array.isArray(payload)) {
    for (const entry of payload) {
      await validateCompositeChildRecord(
        targetModel,
        operation,
        entry,
        tenantId,
        contextClient,
      );
    }
    return payload;
  }
  return validateCompositeChildRecord(
    targetModel,
    operation,
    payload,
    tenantId,
    contextClient,
  );
}

async function verifyCompositeNestedOwnership(
  modelName: string,
  key: string,
  targetModel: string,
  mutKey: string,
  payload: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  const ids = extractTargetIds(payload);
  if (ids.length === 0) {
    return;
  }

  const delegate = getModelDelegate(targetModel, contextClient);
  if (!delegate) {
    throw new Error(
      `[TenantIsolation] Cannot verify tenant ownership for nested relation write on '${modelName}.${key}'. No query client available for model '${targetModel}'.`,
    );
  }

  const rows = await delegate.findMany({
    where: {
      id: { in: ids },
      tenant_id: tenantId,
    },
    select: { id: true },
  });

  if (rows.length !== ids.length) {
    throw new Error(
      `[TenantIsolation] Nested relation '${mutKey}' on '${modelName}.${key}' references records not belonging to current tenant.`,
    );
  }
}

async function handleCompositeConnectOrCreate(
  modelName: string,
  key: string,
  targetModel: string,
  payload: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  const items = toRecordArray(payload);
  for (const record of items) {
    if (record.where) {
      await verifyCompositeNestedOwnership(
        modelName,
        key,
        targetModel,
        'connectOrCreate',
        record.where,
        tenantId,
        contextClient,
      );
    }
    if (record.create) {
      await validateCompositeChildRecord(
        targetModel,
        'create',
        record.create,
        tenantId,
        contextClient,
      );
    }
  }
}

async function validateCompositeUpsertWhere(
  modelName: string,
  key: string,
  targetModel: string,
  where: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  const ids = extractTargetIds(where);
  if (ids.length === 0) {
    return;
  }
  const delegate = getModelDelegate(targetModel, contextClient);
  if (!delegate) {
    return;
  }
  const rows = await delegate.findMany({
    where: { id: { in: ids } },
    select: { id: true, tenant_id: true },
  });
  for (const row of rows) {
    if (row.tenant_id && row.tenant_id !== tenantId) {
      throw new Error(
        `[TenantIsolation] Nested relation 'upsert' on '${modelName}.${key}' references records not belonging to current tenant.`,
      );
    }
  }
}

async function validateCompositeUpsertCreate(
  targetModel: string,
  createData: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  if (createData && typeof createData === 'object') {
    await validateCompositeChildRecord(
      targetModel,
      'create',
      createData,
      tenantId,
      contextClient,
    );
  }
}

async function validateCompositeUpsertUpdate(
  targetModel: string,
  updateData: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  if (updateData && typeof updateData === 'object') {
    assertNoTenantIdInUpdateData(targetModel, 'upsert update', updateData);
    await assertNoTenantScopedNestedWrites(
      targetModel,
      updateData,
      tenantId,
      contextClient,
    );
  }
}

async function handleSingleCompositeUpsert(
  modelName: string,
  key: string,
  targetModel: string,
  entry: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  if (!entry || typeof entry !== 'object') {
    return;
  }
  const record = entry as Record<string, unknown>;
  await validateCompositeUpsertWhere(
    modelName,
    key,
    targetModel,
    record.where,
    tenantId,
    contextClient,
  );
  await validateCompositeUpsertCreate(
    targetModel,
    record.create,
    tenantId,
    contextClient,
  );
  await validateCompositeUpsertUpdate(
    targetModel,
    record.update,
    tenantId,
    contextClient,
  );
}

async function handleCompositeNestedUpsert(
  modelName: string,
  key: string,
  targetModel: string,
  payload: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  const items = toRecordArray(payload);
  for (const item of items) {
    await handleSingleCompositeUpsert(
      modelName,
      key,
      targetModel,
      item,
      tenantId,
      contextClient,
    );
  }
}

async function handleCompositeNestedUpdate(
  targetModel: string,
  payload: unknown,
  tenantId: string,
  contextClient?: unknown,
): Promise<void> {
  const items = toRecordArray(payload);
  for (const item of items) {
    const data: unknown = 'data' in item && item.data ? item.data : item;
    assertNoTenantIdInUpdateData(targetModel, 'update', data);
    await assertNoTenantScopedNestedWrites(
      targetModel,
      data,
      tenantId,
      contextClient,
    );
  }
}

const COMPOSITE_NOOP_MUTATIONS = new Set([
  'delete',
  'deleteMany',
  'disconnect',
]);

async function handleCompositeLinkMutation(
  mutKey: string,
  record: Record<string, unknown>,
  modelName: string,
  key: string,
  targetModel: string,
  tenantId: string,
  contextClient?: unknown,
): Promise<boolean> {
  if (mutKey === 'connect' || mutKey === 'set') {
    await verifyCompositeNestedOwnership(
      modelName,
      key,
      targetModel,
      mutKey,
      record[mutKey],
      tenantId,
      contextClient,
    );
    return true;
  }
  if (mutKey === 'connectOrCreate') {
    await handleCompositeConnectOrCreate(
      modelName,
      key,
      targetModel,
      record.connectOrCreate,
      tenantId,
      contextClient,
    );
    return true;
  }
  return false;
}

type ChildPayloadTransformer = (
  targetModel: string,
  kind: 'create' | 'createMany',
  data: unknown,
  tenantId: string,
  contextClient?: unknown,
) => Promise<unknown>;

async function applyChildCreateMutation(
  mutKey: string,
  record: Record<string, unknown>,
  targetModel: string,
  tenantId: string,
  contextClient: unknown,
  transform: ChildPayloadTransformer,
): Promise<boolean> {
  if (mutKey === 'create') {
    record.create = await transform(
      targetModel,
      'create',
      record.create,
      tenantId,
      contextClient,
    );
    return true;
  }

  if (mutKey === 'createMany') {
    const rawData = extractCreateManyData(record.createMany);
    if (rawData !== undefined) {
      (record.createMany as Record<string, unknown>).data = await transform(
        targetModel,
        'createMany',
        rawData,
        tenantId,
        contextClient,
      );
    }
    return true;
  }

  return false;
}

async function handleCompositeWriteMutation(
  mutKey: string,
  record: Record<string, unknown>,
  modelName: string,
  key: string,
  targetModel: string,
  tenantId: string,
  contextClient?: unknown,
): Promise<boolean> {
  const handledCreate = await applyChildCreateMutation(
    mutKey,
    record,
    targetModel,
    tenantId,
    contextClient,
    validateCompositeChildPayload,
  );
  if (handledCreate) {
    return true;
  }

  if (mutKey === 'upsert') {
    await handleCompositeNestedUpsert(
      modelName,
      key,
      targetModel,
      record.upsert,
      tenantId,
      contextClient,
    );
    return true;
  }

  if (mutKey === 'update' || mutKey === 'updateMany') {
    await handleCompositeNestedUpdate(
      targetModel,
      record[mutKey],
      tenantId,
      contextClient,
    );
    return true;
  }

  return false;
}

async function handleCompositeMutation(
  mutKey: string,
  record: Record<string, unknown>,
  modelName: string,
  key: string,
  targetModel: string,
  tenantId: string,
  contextClient?: unknown,
): Promise<boolean> {
  if (
    await handleCompositeLinkMutation(
      mutKey,
      record,
      modelName,
      key,
      targetModel,
      tenantId,
      contextClient,
    )
  ) {
    return true;
  }
  if (
    await handleCompositeWriteMutation(
      mutKey,
      record,
      modelName,
      key,
      targetModel,
      tenantId,
      contextClient,
    )
  ) {
    return true;
  }
  return COMPOSITE_NOOP_MUTATIONS.has(mutKey);
}

async function handleCompositeNestedRelationWrite(
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
    (mutKey) =>
      handleCompositeMutation(
        mutKey,
        record,
        modelName,
        key,
        targetModel,
        tenantId,
        contextClient,
      ),
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

async function handleSingleKeyChildMutation(
  mutKey: string,
  record: Record<string, unknown>,
  targetModel: string,
  tenantId: string,
  contextClient?: unknown,
): Promise<boolean> {
  return applyChildCreateMutation(
    mutKey,
    record,
    targetModel,
    tenantId,
    contextClient,
    stampAndValidateChildPayload,
  );
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
    (mutKey) =>
      handleSingleKeyChildMutation(
        mutKey,
        record,
        targetModel,
        tenantId,
        contextClient,
      ),
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
    await handleCompositeNestedRelationWrite(
      modelName,
      key,
      value,
      targetModel ?? key,
      tenantId,
      contextClient,
    );
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

  return dispatchTenantOperation(
    model,
    operation,
    nextArgs,
    tenantId,
    query,
    baseClient,
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

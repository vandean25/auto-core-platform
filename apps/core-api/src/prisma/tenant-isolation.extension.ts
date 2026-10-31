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
  | 'scoped'
  | 'stamped'
  | 'rejected'
  | 'composite';

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
      `[TenantIsolation] Mismatching tenant_id '${normalized.tenant_id}' in ${operation} on model '${model}'. Expected '${tenantId}'.`,
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

/**
 * The core $allOperations handler logic — extracted for unit testability.
 * Applies tenant isolation rules to a single Prisma operation.
 *
 * `baseClient` is the client captured at extension definition. It is kept in
 * the signature to make the isolation boundary explicit, but the extension
 * must never query through it: it lives outside every active transaction and
 * dry-run context.
 */
export function applyTenantIsolation(
  this: unknown,
  baseClient: unknown,
  model: string,
  operation: string,
  args: unknown,
  query: (args: Record<string, unknown>) => Promise<unknown>,
): Promise<unknown> {
  return (async () => {
    const nextArgs = normalizeRecord(args);

    // Pass through for models without a tenant_id column
    if (GLOBAL_MODELS.has(model)) {
      return query(nextArgs);
    }

    // Developer guard: findUnique bypasses tenant isolation due to Prisma's
    // unique-index type constraints, so it must not be used in tenant-scoped code.
    if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
      throw new Error(
        `[TenantIsolation] Do not use ${operation}() on model '${model}'. ` +
          `Use findFirst() with an explicit where clause instead. ` +
          `findUnique() bypasses tenant_id injection due to Prisma unique-index type constraints.`,
      );
    }

    if (operation === 'findRaw' || operation === 'aggregateRaw') {
      throw new Error(
        `[TenantIsolation] Do not use ${operation}() on model '${model}'. ` +
          `Raw queries bypass tenant isolation.`,
      );
    }

    const tenantId = getCurrentTenantId();

    // Read + bulk-mutation operations: inject into where clause
    if (FILTERABLE_OPERATIONS.has(operation)) {
      if (operation === 'updateMany' || operation === 'updateManyAndReturn') {
        assertNoTenantIdInUpdateData(model, operation, nextArgs.data);
      }

      nextArgs.where = {
        ...normalizeRecord(nextArgs.where),
        tenant_id: tenantId,
      };

      return query(nextArgs);
    }

    // Targeted single-row mutations: the tenant is part of the write selector,
    // so the ownership check and the write are one atomic statement.
    if (operation === 'update' || operation === 'delete') {
      if (operation === 'update') {
        assertNoTenantIdInUpdateData(model, 'update', nextArgs.data);
      }

      const { scopedWhere, injected } = injectTenantIntoWhere(
        nextArgs.where as Record<string, unknown> | undefined,
        tenantId,
      );

      if (Object.keys(scopedWhere).length === 0) {
        throw new Error(
          `[TenantIsolation] ${operation}() on model '${model}' requires a where clause.`,
        );
      }

      if (injected) {
        nextArgs.where = scopedWhere;

        return query(nextArgs);
      }

      nextArgs.where = { ...scopedWhere, tenant_id: tenantId };

      try {
        return await query(nextArgs);
      } catch (error) {
        if (!isRecordNotFoundError(error)) {
          throw error;
        }

        throw new NotFoundException(
          `[TenantIsolation] ${model} record not found for current tenant.`,
        );
      }
    }

    // create: stamp tenant_id onto the new record
    if (operation === 'create') {
      nextArgs.data = validateAndStampCreateData(
        model,
        'create',
        nextArgs.data,
        tenantId,
      );

      return query(nextArgs);
    }

    if (operation === 'createMany' || operation === 'createManyAndReturn') {
      nextArgs.data = stampTenantIntoCreateManyData(
        model,
        operation,
        nextArgs.data,
        tenantId,
      );

      return query(nextArgs);
    }

    // upsert: tenant_id required in both where (lookup) and create (new row)
    if (operation === 'upsert') {
      assertNoTenantIdInUpdateData(model, 'upsert update', nextArgs.update);

      nextArgs.where = scopeUpsertWhere(
        model,
        nextArgs.where as Record<string, unknown> | undefined,
        tenantId,
      );
      nextArgs.create = validateAndStampCreateData(
        model,
        'create',
        nextArgs.create,
        tenantId,
      );

      return query(nextArgs);
    }

    logger.error(
      `[TenantIsolation] Denied unhandled operation '${operation}' on model '${model}'.`,
    );
    throw new Error(
      `[TenantIsolation] Operation '${operation}' on model '${model}' is not permitted by tenant isolation policy.`,
    );
  })();
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

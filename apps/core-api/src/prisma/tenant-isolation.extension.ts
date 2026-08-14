import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextStorage } from '../common/services/tenant-context.storage';
import { resolvePrismaModelDelegate } from './prisma-delegate';

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

function stampTenantIntoCreateManyData(data: unknown, tenantId: string) {
  if (Array.isArray(data)) {
    return data.map((item) => ({
      ...normalizeRecord(item),
      tenant_id: tenantId,
    }));
  }

  return {
    ...normalizeRecord(data),
    tenant_id: tenantId,
  };
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

function buildTenantOwnershipWhere(
  where: Record<string, unknown>,
  tenantId: string,
): Record<string, unknown> {
  return {
    AND: [where, { tenant_id: tenantId }],
  };
}

/**
 * The core $allOperations handler logic — extracted for unit testability.
 * Applies tenant isolation rules to a single Prisma operation.
 */
export function applyTenantIsolation(
  this: unknown,
  ctx: any,
  model: string,
  operation: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (args: any) => Promise<unknown>,
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

    const tenantId = getCurrentTenantId();

    // Read + bulk-mutation operations: inject into where clause
    if (FILTERABLE_OPERATIONS.has(operation)) {
      nextArgs.where = {
        ...normalizeRecord(nextArgs.where),
        tenant_id: tenantId,
      };

      return query(nextArgs);
    }

    // Targeted single-row mutations: pre-check against the current tenant and
    // then execute the write with the caller's unique selector.
    if (operation === 'update' || operation === 'delete') {
      const { scopedWhere, injected } = injectTenantIntoWhere(
        nextArgs.where as Record<string, unknown> | undefined,
        tenantId,
      );
      const where = scopedWhere;

      if (Object.keys(where).length === 0) {
        throw new Error(
          `[TenantIsolation] ${operation}() on model '${model}' requires a where clause.`,
        );
      }

      if (injected) {
        nextArgs.where = where;

        return query(nextArgs);
      }

      const extensionContext = Prisma.getExtensionContext(this) as Record<
        string,
        unknown
      >;
      const modelDelegate =
        resolvePrismaModelDelegate(ctx as Record<string, unknown>, model) ??
        resolvePrismaModelDelegate(extensionContext, model);

      if (typeof modelDelegate?.findFirst !== 'function') {
        throw new Error(
          `[TenantIsolation] Unable to resolve delegate for model '${model}'.`,
        );
      }

      const existing = await modelDelegate.findFirst({
        where: buildTenantOwnershipWhere(where, tenantId),
        select: { id: true },
      });

      if (!existing) {
        throw new NotFoundException(
          `[TenantIsolation] ${model} record not found for current tenant.`,
        );
      }

      return query(nextArgs);
    }

    // create: stamp tenant_id onto the new record
    if (operation === 'create') {
      nextArgs.data = {
        ...normalizeRecord(nextArgs.data),
        tenant_id: tenantId,
      };

      return query(nextArgs);
    }

    if (operation === 'createMany') {
      nextArgs.data = stampTenantIntoCreateManyData(nextArgs.data, tenantId);

      return query(nextArgs);
    }

    // upsert: tenant_id required in both where (lookup) and create (new row)
    if (operation === 'upsert') {
      nextArgs.where = scopeUpsertWhere(
        model,
        nextArgs.where as Record<string, unknown> | undefined,
        tenantId,
      );
      nextArgs.create = {
        ...normalizeRecord(nextArgs.create),
        tenant_id: tenantId,
      };

      return query(nextArgs);
    }

    // Passthrough for any unhandled operations (createMany, etc.)

    return query(nextArgs);
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async $allOperations({ model, operation, args, query }: any) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
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

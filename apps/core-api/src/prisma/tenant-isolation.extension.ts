import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextStorage } from '../common/services/tenant-context.storage';

/**
 * Models that do NOT carry a tenant_id column and must bypass tenant isolation.
 * These are either the root Tenant entity itself, or shared resource entities
 * (Employees, Bays) that are configured globally for the workshop system.
 */
const GLOBAL_MODELS = new Set(['Tenant', 'Employee', 'Bay']);

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

/**
 * The core $allOperations handler logic — extracted for unit testability.
 * Applies tenant isolation rules to a single Prisma operation.
 */
export function applyTenantIsolation(
  model: string,
  operation: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (args: any) => unknown,
): unknown {
  // Pass through for models without a tenant_id column
  if (GLOBAL_MODELS.has(model)) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return query(args);
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    args.where = { ...args.where, tenant_id: tenantId };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return query(args);
  }

  // Targeted single-row mutations: scope where to prevent cross-tenant writes
  if (operation === 'update' || operation === 'delete') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    args.where = { ...args.where, tenant_id: tenantId };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return query(args);
  }

  // create: stamp tenant_id onto the new record
  if (operation === 'create') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    args.data = { ...args.data, tenant_id: tenantId };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return query(args);
  }

  // upsert: tenant_id required in both where (lookup) and create (new row)
  if (operation === 'upsert') {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    args.where = { ...args.where, tenant_id: tenantId };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    args.create = { ...args.create, tenant_id: tenantId };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return query(args);
  }

  // Passthrough for any unhandled operations (createMany, etc.)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
  return query(args);
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
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        $allOperations({ model, operation, args, query }: any) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return applyTenantIsolation(model, operation, args, query);
        },
      },
    },
  });
}

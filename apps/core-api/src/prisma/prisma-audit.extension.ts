import { InternalServerErrorException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildAuditChangeSet,
  normalizeAuditValue,
} from '../audit/audit-diff.util';
import { redactAuditSecrets } from '../audit/audit-redaction.util';
import {
  TenantContextStorage,
  type RequestMeta,
} from '../common/services/tenant-context.storage';
import type { AuthenticatedUser } from '../auth/types/authenticated-user';
import { resolvePrismaModelDelegate } from './prisma-delegate';

type PrismaQueryArgs = {
  where?: Record<string, unknown>;
  [key: string]: unknown;
};

type PrismaQueryFn = (args: PrismaQueryArgs) => Promise<unknown>;

type AuditLogDelegate = {
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
};

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

function getRequiredTenantContext(): {
  tenantId: string;
  user: AuthenticatedUser;
  requestMeta?: RequestMeta;
} {
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

export async function applyAuditUpdate(
  this: unknown,
  ctx: unknown,
  model: string,
  args: PrismaQueryArgs,
  query: PrismaQueryFn,
): Promise<unknown> {
  if (model === 'AuditLog' || !AUDITED_MODELS.has(model)) {
    return query(args);
  }

  const { tenantId, user, requestMeta } = getRequiredTenantContext();

  const extensionContext = (Prisma.getExtensionContext(this) ?? {}) as Record<
    string,
    unknown
  >;
  const modelDelegate =
    resolvePrismaModelDelegate(ctx as Record<string, unknown>, model) ??
    resolvePrismaModelDelegate(extensionContext, model);

  let beforeRaw: unknown = undefined;
  if (typeof modelDelegate?.findFirst === 'function' && args?.where) {
    try {
      beforeRaw = await modelDelegate.findFirst({ where: args.where });
    } catch {
      // Composite unique keys (e.g. tenant_id_code) are valid for update
      // but rejected by findFirst — proceed without a before snapshot.
    }
  }

  const afterRaw = await query(args);

  const changeSet = buildAuditChangeSet(beforeRaw, afterRaw);
  const entityId =
    extractEntityId(afterRaw) ??
    extractEntityId(beforeRaw) ??
    whereIdAsString(args);

  const auditLogDelegate = resolveAuditLogDelegate(
    ctx as Record<string, unknown>,
    extensionContext,
  );

  if (typeof auditLogDelegate?.create === 'function') {
    await auditLogDelegate.create({
      data: {
        tenant_id: tenantId,
        entity_type: model,
        entity_id: entityId,
        action: 'UPDATE',
        actor_user_id: user.userId ?? null,
        actor_email: user.email ?? null,
        actor_role: user.role ?? null,
        actor_type: resolveActorType(user, requestMeta),
        request_id: requestMeta?.requestId ?? null,
        source: requestMeta?.source ?? 'API',
        ip_address: requestMeta?.ip ?? null,
        user_agent: requestMeta?.userAgent ?? null,
        before: changeSet.before,
        after: changeSet.after,
        diff: changeSet.diff,
        changed_fields: changeSet.changedFields,
        redacted_fields: changeSet.redactedFields,
      },
    });
  }

  return afterRaw;
}

export async function applyAuditDelete(
  this: unknown,
  ctx: unknown,
  model: string,
  args: PrismaQueryArgs,
  query: PrismaQueryFn,
): Promise<unknown> {
  if (model === 'AuditLog' || !AUDITED_MODELS.has(model)) {
    return query(args);
  }

  const { tenantId, user, requestMeta } = getRequiredTenantContext();

  const extensionContext = (Prisma.getExtensionContext(this) ?? {}) as Record<
    string,
    unknown
  >;
  const modelDelegate =
    resolvePrismaModelDelegate(ctx as Record<string, unknown>, model) ??
    resolvePrismaModelDelegate(extensionContext, model);

  let beforeRaw: unknown = undefined;
  if (typeof modelDelegate?.findFirst === 'function' && args?.where) {
    try {
      beforeRaw = await modelDelegate.findFirst({ where: args.where });
    } catch {
      // Composite unique keys (e.g. tenant_id_code) are valid for delete
      // but rejected by findFirst — proceed without a before snapshot.
    }
  }

  const deletedRaw = await query(args);

  const normalizedBefore = normalizeAuditValue(beforeRaw ?? deletedRaw);
  const redactedBefore = redactAuditSecrets(normalizedBefore);
  const entityId =
    extractEntityId(beforeRaw) ??
    extractEntityId(deletedRaw) ??
    whereIdAsString(args);

  const auditLogDelegate = resolveAuditLogDelegate(
    ctx as Record<string, unknown>,
    extensionContext,
  );

  if (typeof auditLogDelegate?.create === 'function') {
    await auditLogDelegate.create({
      data: {
        tenant_id: tenantId,
        entity_type: model,
        entity_id: entityId,
        action: 'DELETE',
        actor_user_id: user.userId ?? null,
        actor_email: user.email ?? null,
        actor_role: user.role ?? null,
        actor_type: resolveActorType(user, requestMeta),
        request_id: requestMeta?.requestId ?? null,
        source: requestMeta?.source ?? 'API',
        ip_address: requestMeta?.ip ?? null,
        user_agent: requestMeta?.userAgent ?? null,
        before: redactedBefore.value,
        after: null,
        diff: null,
        changed_fields: [],
        redacted_fields: redactedBefore.redactedPaths,
      },
    });
  }

  return deletedRaw;
}

export async function applyAuditUpdateMany(
  this: unknown,
  ctx: unknown,
  model: string,
  args: PrismaQueryArgs,
  query: PrismaQueryFn,
): Promise<unknown> {
  if (model === 'AuditLog' || !AUDITED_MODELS.has(model)) {
    return query(args);
  }

  const { tenantId, user, requestMeta } = getRequiredTenantContext();

  const extensionContext = (Prisma.getExtensionContext(this) ?? {}) as Record<
    string,
    unknown
  >;
  const modelDelegate =
    resolvePrismaModelDelegate(ctx as Record<string, unknown>, model) ??
    resolvePrismaModelDelegate(extensionContext, model);

  let beforeRows: unknown[] = [];
  if (typeof modelDelegate?.findMany === 'function' && args?.where) {
    beforeRows =
      (await modelDelegate.findMany({
        where: args.where,
      })) ?? [];
  }

  const result = (await query(args)) as { count: number };

  if (!result || result.count === 0 || beforeRows.length === 0) {
    return result;
  }

  const auditLogDelegate = resolveAuditLogDelegate(
    ctx as Record<string, unknown>,
    extensionContext,
  );

  if (typeof auditLogDelegate?.create === 'function') {
    const affectedIds = beforeRows
      .map((r) => extractEntityId(r))
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    let afterRows: unknown[] = [];
    if (
      typeof modelDelegate?.findMany === 'function' &&
      affectedIds.length > 0
    ) {
      afterRows =
        (await modelDelegate.findMany({
          where: { id: { in: affectedIds } },
        })) ?? [];
    }

    const afterMap = new Map<string, unknown>();
    for (const afterRow of afterRows) {
      const id = extractEntityId(afterRow);
      if (id) {
        afterMap.set(id, afterRow);
      }
    }

    for (const beforeRow of beforeRows) {
      const entityId = extractEntityId(beforeRow) ?? '';
      const afterRow = afterMap.get(entityId) ?? beforeRow;
      const changeSet = buildAuditChangeSet(beforeRow, afterRow);

      await auditLogDelegate.create({
        data: {
          tenant_id: tenantId,
          entity_type: model,
          entity_id: entityId,
          action: 'UPDATE',
          actor_user_id: user.userId ?? null,
          actor_email: user.email ?? null,
          actor_role: user.role ?? null,
          actor_type: resolveActorType(user, requestMeta),
          request_id: requestMeta?.requestId ?? null,
          source: requestMeta?.source ?? 'API',
          ip_address: requestMeta?.ip ?? null,
          user_agent: requestMeta?.userAgent ?? null,
          before: changeSet.before,
          after: changeSet.after,
          diff: changeSet.diff,
          changed_fields: changeSet.changedFields,
          redacted_fields: changeSet.redactedFields,
        },
      });
    }
  }

  return result;
}

export async function applyAuditDeleteMany(
  this: unknown,
  ctx: unknown,
  model: string,
  args: PrismaQueryArgs,
  query: PrismaQueryFn,
): Promise<unknown> {
  if (model === 'AuditLog' || !AUDITED_MODELS.has(model)) {
    return query(args);
  }

  const { tenantId, user, requestMeta } = getRequiredTenantContext();

  const extensionContext = (Prisma.getExtensionContext(this) ?? {}) as Record<
    string,
    unknown
  >;
  const modelDelegate =
    resolvePrismaModelDelegate(ctx as Record<string, unknown>, model) ??
    resolvePrismaModelDelegate(extensionContext, model);

  let beforeRows: unknown[] = [];
  if (typeof modelDelegate?.findMany === 'function' && args?.where) {
    beforeRows =
      (await modelDelegate.findMany({
        where: args.where,
      })) ?? [];
  }

  const result = (await query(args)) as { count: number };

  if (!result || result.count === 0 || beforeRows.length === 0) {
    return result;
  }

  const auditLogDelegate = resolveAuditLogDelegate(
    ctx as Record<string, unknown>,
    extensionContext,
  );

  if (typeof auditLogDelegate?.create === 'function') {
    for (const row of beforeRows) {
      const normalizedBefore = normalizeAuditValue(row);
      const redactedBefore = redactAuditSecrets(normalizedBefore);
      const entityId = extractEntityId(row) ?? '';

      await auditLogDelegate.create({
        data: {
          tenant_id: tenantId,
          entity_type: model,
          entity_id: entityId,
          action: 'DELETE',
          actor_user_id: user.userId ?? null,
          actor_email: user.email ?? null,
          actor_role: user.role ?? null,
          actor_type: resolveActorType(user, requestMeta),
          request_id: requestMeta?.requestId ?? null,
          source: requestMeta?.source ?? 'API',
          ip_address: requestMeta?.ip ?? null,
          user_agent: requestMeta?.userAgent ?? null,
          before: redactedBefore.value,
          after: null,
          diff: null,
          changed_fields: [],
          redacted_fields: redactedBefore.redactedPaths,
        },
      });
    }
  }

  return result;
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

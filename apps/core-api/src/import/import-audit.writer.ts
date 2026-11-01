import { AuditActorType, AuditLogAction, Prisma } from '@prisma/client';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { buildImportAuditDiff } from './import-audit.util.js';
import { IMPORT_SOURCE } from './import.constants.js';
import type { ImportJobTotals } from './import.types.js';

/** Writes the audit entries of an import: one per changed entity, and one per job event. */
export class ImportAuditWriter {
  constructor(private readonly tenantContext: TenantContextService) {}

  async writeEntityAudit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorUserId: string,
    importJobId: string,
    entityType: string,
    entityId: string,
    action: AuditLogAction,
    before: unknown,
    after: unknown,
  ): Promise<void> {
    const authUser = this.tenantContext.getAuthenticatedUser();
    const diff = buildImportAuditDiff(before, after);
    await tx.auditLog.create({
      data: {
        tenant_id: tenantId,
        entity_type: entityType,
        entity_id: entityId,
        action,
        actor_user_id: actorUserId,
        actor_email: authUser?.email ?? null,
        actor_role: authUser?.role ?? null,
        actor_type: AuditActorType.USER,
        source: IMPORT_SOURCE,
        before: before ? (before as Prisma.InputJsonValue) : Prisma.JsonNull,
        after: {
          ...(after && typeof after === 'object'
            ? (after as Record<string, unknown>)
            : {}),
          importJobId,
        },
        diff: (diff as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
  }

  async writeImportJobAudit(
    client: Pick<Prisma.TransactionClient, 'auditLog'>,
    tenantId: string,
    actorUserId: string,
    jobId: string,
    event: 'created' | 'applied',
    totals?: ImportJobTotals,
  ): Promise<void> {
    const authUser = this.tenantContext.getAuthenticatedUser();
    await client.auditLog.create({
      data: {
        tenant_id: tenantId,
        entity_type: 'ImportJob',
        entity_id: jobId,
        action:
          event === 'created' ? AuditLogAction.CREATE : AuditLogAction.UPDATE,
        actor_user_id: actorUserId,
        actor_email: authUser?.email ?? null,
        actor_role: authUser?.role ?? null,
        actor_type: AuditActorType.USER,
        source: IMPORT_SOURCE,
        after: {
          event: `import_job.${event}`,
          importJobId: jobId,
          totals,
        },
      },
    });
  }
  async writeImportJobUndoAudit(
    client: Pick<Prisma.TransactionClient, 'auditLog'>,
    tenantId: string,
    actorUserId: string,
    jobId: string,
    outcome: {
      status: 'UNDONE' | 'PARTIALLY_UNDONE';
      deletedCount: number;
      restoredCount: number;
      blockedCount: number;
      blockedReasons?: Record<string, string>;
    },
  ): Promise<void> {
    const authUser = this.tenantContext.getAuthenticatedUser();
    await client.auditLog.create({
      data: {
        tenant_id: tenantId,
        entity_type: 'ImportJob',
        entity_id: jobId,
        action: AuditLogAction.UPDATE,
        actor_user_id: actorUserId,
        actor_email: authUser?.email ?? null,
        actor_role: authUser?.role ?? null,
        actor_type: AuditActorType.USER,
        source: IMPORT_SOURCE,
        after: {
          event: 'import_job.undone',
          importJobId: jobId,
          outcome,
        },
      },
    });
  }
}

import type { Prisma } from '@prisma/client';

type ScopeEpochTx = Pick<Prisma.TransactionClient, 'tenantMember' | 'tenant'>;

export type AdvanceScopeEpochInput =
  | { kind: 'member'; tenantId: string; userId: string }
  | { kind: 'allMembershipsForUser'; userId: string }
  | { kind: 'tenantAuthorization'; tenantId: string };

export async function advanceScopeEpoch(
  tx: ScopeEpochTx,
  input: AdvanceScopeEpochInput,
): Promise<void> {
  switch (input.kind) {
    case 'member':
      await tx.tenantMember.updateMany({
        where: { tenant_id: input.tenantId, user_id: input.userId },
        data: { scope_epoch: { increment: 1 } },
      });
      return;
    case 'allMembershipsForUser':
      await tx.tenantMember.updateMany({
        where: { user_id: input.userId },
        data: { scope_epoch: { increment: 1 } },
      });
      return;
    case 'tenantAuthorization':
      await tx.tenant.updateMany({
        where: { id: input.tenantId },
        data: { authorization_epoch: { increment: 1 } },
      });
      return;
    default: {
      const _exhaustive: never = input;
      throw new Error(`Unknown scope epoch input: ${String(_exhaustive)}`);
    }
  }
}

import { Injectable } from '@nestjs/common';
import { isMembershipCurrentlyValid } from '../auth/membership-validity.js';
import { isDemoMutationAllowed } from '../landing-demo-access/demo-role-restrictions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PermissionId } from './permission-catalogue.js';
import { MCP_TOOL_TABLE, OPERATION_TABLE } from './operation-table.js';
import type { LegacyRole, ProtectedOperation } from './operation-types.js';

/** A tenant member's effective access. `role` is null for a member who holds no domain role. */
export type EffectiveAccess = {
  role: LegacyRole | null;
  permissions: ReadonlySet<PermissionId>;
};

export type OperationRequest = { method: string; path: string };

const LEGACY_ROLES: readonly LegacyRole[] = [
  'OWNER',
  'ADMIN',
  'TECH',
  'SALES',
  'DEMO',
];

/**
 * Legacy adapter: a role holds every permission that a protected operation grants it in the 1a table.
 * OWNER and DEMO are baselines of the same table; the DEMO request mask is applied in `isOperationAllowed`.
 */
const PERMISSIONS_BY_ROLE: Readonly<Record<LegacyRole, Set<PermissionId>>> =
  Object.fromEntries(
    LEGACY_ROLES.map((role) => [role, new Set<PermissionId>()]),
  ) as Record<LegacyRole, Set<PermissionId>>;

for (const entry of [
  ...Object.values(OPERATION_TABLE),
  ...Object.values(MCP_TOOL_TABLE),
]) {
  if (entry.kind === 'protected') {
    for (const role of entry.legacy) {
      entry.permissions.forEach((permission) =>
        PERMISSIONS_BY_ROLE[role].add(permission),
      );
    }
  }
}

export function legacyAccess(role: LegacyRole | null): EffectiveAccess {
  return {
    role,
    permissions: role ? PERMISSIONS_BY_ROLE[role] : new Set<PermissionId>(),
  };
}

/** The decision for one operation. The DEMO mask wins over every granted permission. */
export function isOperationAllowed(
  operation: ProtectedOperation,
  access: EffectiveAccess,
  request: OperationRequest,
): boolean {
  if (
    access.role === 'DEMO' &&
    !isDemoMutationAllowed(request.method, request.path)
  ) {
    return false;
  }
  const holds = (permission: PermissionId) =>
    access.permissions.has(permission);
  return operation.selectedByInput
    ? operation.permissions.some(holds)
    : operation.permissions.every(holds);
}

export type MemberPrincipal = { userId: string; tenantId: string };

/**
 * Resolves the active tenant membership from the database. The result is kept for the request it was
 * resolved for (`scope`, a request or MCP call object) and never across requests. Nothing is read from claims.
 */
@Injectable()
export class PermissionResolver {
  private readonly snapshots = new WeakMap<
    object,
    Promise<EffectiveAccess | null>
  >();

  constructor(private readonly prisma: PrismaService) {}

  resolve(
    scope: object,
    principal: MemberPrincipal,
  ): Promise<EffectiveAccess | null> {
    const cached = this.snapshots.get(scope);
    if (cached) {
      return cached;
    }
    const snapshot = this.load(principal);
    this.snapshots.set(scope, snapshot);
    return snapshot;
  }

  private async load(
    principal: MemberPrincipal,
  ): Promise<EffectiveAccess | null> {
    const member = await this.prisma.tenantMember.findFirst({
      where: {
        tenant_id: principal.tenantId,
        is_active: true,
        user: { firebaseUid: principal.userId },
      },
      select: { role: true, demo_access_expires_at: true },
    });
    return member && isMembershipCurrentlyValid(member)
      ? legacyAccess(member.role)
      : null;
  }
}

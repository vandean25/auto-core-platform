import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma, TenantMemberRole } from '@prisma/client';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { OPERATION_TABLE } from '../../permissions/operation-table.js';
import {
  isMemberAllowed,
  legacyAccess,
} from '../../permissions/permission-resolver.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { TenantAuthenticatedUser } from '../types/authenticated-user.js';
import { isMembershipCurrentlyValid } from '../membership-validity.js';
import { SCOPE_CONTEXT_POLICY_OPERATION_IDS } from './scope-context.constants.js';
import { findValidatedActiveSiteIdForTenant } from './scope-context-active-site.js';
import { getScopeContextPolicyDigest } from './scope-context-policy-digest.js';
import { readScopeContextHmacSecrets } from './scope-context-secret.js';
import {
  continuityDigestCandidates,
  scopeContextDigest,
  verifyScopeContextToken,
  type ScopeContextComponents,
} from './scope-context-token.js';

type CursorListTable = 'catalogItem' | 'invoice' | 'vehicle' | 'workshopOrder';
type CursorListReader = {
  [Table in CursorListTable]: Pick<Prisma.TransactionClient[Table], 'findMany'>;
};

type ScopeContextSnapshot = {
  tx: CursorListReader;
  tenantId: string;
  siteId: string;
  scopeContextDigest: string;
};

type SnapshotOperation = {
  id: (typeof SCOPE_CONTEXT_POLICY_OPERATION_IDS)[number];
  scope?: 'tenant';
};

function assertSnapshotPermission(
  operation: SnapshotOperation['id'],
  role: TenantMemberRole,
): void {
  const entry = OPERATION_TABLE[operation];
  if (
    entry?.kind !== 'protected' ||
    !isMemberAllowed(entry, legacyAccess(role), { method: 'GET', path: '' })
  ) {
    throw new ForbiddenException('Missing permission for this operation.');
  }
}

function contextRequired(): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.PRECONDITION_REQUIRED,
      code: 'CONTEXT_REQUIRED',
      message: 'This list request needs the X-ACP-Scope-Context header.',
    },
    HttpStatus.PRECONDITION_REQUIRED,
  );
}

function contextMismatch(): HttpException {
  return new HttpException(
    {
      statusCode: HttpStatus.PRECONDITION_FAILED,
      code: 'CONTEXT_MISMATCH',
      message: 'The scope context no longer matches the current access.',
    },
    HttpStatus.PRECONDITION_FAILED,
  );
}

/** A signature that no current or previous key accepts (for example after key rotation) is a mismatch (ADR-0038 §1). */
function verifyPresentedContext(token: string): ScopeContextComponents {
  try {
    readScopeContextHmacSecrets();
  } catch {
    throw new ServiceUnavailableException('Scope context is not configured.');
  }
  try {
    return verifyScopeContextToken(token);
  } catch {
    throw contextMismatch();
  }
}

type SnapshotComponents = Omit<ScopeContextComponents, 'continuityDigest'> & {
  continuityDigests: readonly string[];
};

function componentsMatch(
  presented: ScopeContextComponents,
  snapshot: SnapshotComponents,
): boolean {
  return (
    presented.principalSub === snapshot.principalSub &&
    snapshot.continuityDigests.includes(presented.continuityDigest) &&
    presented.tenantId === snapshot.tenantId &&
    presented.siteId === snapshot.siteId &&
    presented.scopeEpoch === snapshot.scopeEpoch &&
    presented.authorizationEpoch === snapshot.authorizationEpoch &&
    presented.policyVersion === snapshot.policyVersion
  );
}

/**
 * ADR-0038 §4 decision point for cursor lists and their counts: one REPEATABLE READ transaction reads
 * membership, tenant and site activity, both epochs and the ended lineage, compares them with the presented
 * Scope Context and then runs the data read in the same snapshot.
 * Precedence: 401 / 403 / 422, then context errors, then the caller's cursor errors.
 */
@Injectable()
export class ScopeContextSnapshotService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async read<T>(
    headerValue: string | undefined,
    operation: SnapshotOperation,
    read: (snapshot: ScopeContextSnapshot) => Promise<T>,
  ): Promise<T> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.tenantId || user.role === undefined) {
      throw new UnauthorizedException('Tenant session required.');
    }
    const principal = { ...user, tenantId: user.tenantId, role: user.role };
    return this.prisma.$transaction(
      async (tx) => {
        const snapshot = await readSnapshotComponents(tx, principal, operation);
        const token = headerValue?.trim();
        if (!token) {
          throw contextRequired();
        }
        const presented = verifyPresentedContext(token);
        if (!componentsMatch(presented, snapshot)) {
          throw contextMismatch();
        }
        return read({
          tx,
          tenantId: snapshot.tenantId,
          siteId: snapshot.siteId,
          scopeContextDigest: scopeContextDigest(token),
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}

async function readSnapshotComponents(
  tx: Prisma.TransactionClient,
  user: TenantAuthenticatedUser,
  operation: SnapshotOperation,
): Promise<SnapshotComponents> {
  const tenantId = user.tenantId;
  const continuityDigests =
    user.authTimeSeconds === undefined
      ? []
      : continuityDigestCandidates(user.userId, user.authTimeSeconds);
  const [endedLineage, member, tenant, siteId] = await Promise.all([
    tx.endedSessionLineage.findFirst({
      where: {
        tenant_id: tenantId,
        continuity_digest: { in: [...continuityDigests] },
      },
      select: { id: true },
    }),
    tx.tenantMember.findFirst({
      where: {
        tenant_id: tenantId,
        user: { firebaseUid: user.userId },
        is_active: true,
      },
      select: { scope_epoch: true, role: true, demo_access_expires_at: true },
    }),
    tx.tenant.findFirst({
      where: { id: tenantId, is_active: true },
      select: { authorization_epoch: true },
    }),
    findValidatedActiveSiteIdForTenant(
      tx,
      user.userId,
      tenantId,
      operation.scope === 'tenant',
    ),
  ]);
  if (endedLineage) {
    throw new UnauthorizedException('Session lineage has ended.');
  }
  if (!member || !tenant || !isMembershipCurrentlyValid(member)) {
    throw new UnauthorizedException('Tenant membership is not active.');
  }
  assertSnapshotPermission(operation.id, member.role);
  if (siteId === null) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      code: 'ACTIVE_SITE_REQUIRED',
      message: 'An active site is required.',
    });
  }
  return {
    principalSub: user.userId,
    continuityDigests,
    tenantId,
    siteId,
    scopeEpoch: member.scope_epoch,
    authorizationEpoch: tenant.authorization_epoch,
    policyVersion: getScopeContextPolicyDigest(),
  };
}

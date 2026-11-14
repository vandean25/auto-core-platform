import {
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { TenantAuthenticatedUser } from '../types/authenticated-user.js';
import { findValidatedActiveSiteIdForTenant } from './scope-context-active-site.js';
import { getScopeContextPolicyDigest } from './scope-context-policy-digest.js';
import { readScopeContextHmacSecrets } from './scope-context-secret.js';
import {
  continuityDigestCandidates,
  verifyScopeContextToken,
  type ScopeContextComponents,
} from './scope-context-token.js';

type ScopeContextSnapshot = {
  tx: Prisma.TransactionClient;
  siteId: string;
};

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
 * Precedence: 401 / 422 first, then CONTEXT_REQUIRED (428) / CONTEXT_MISMATCH (412), then the caller's codes.
 */
@Injectable()
export class ScopeContextSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  async read<T>(
    user: TenantAuthenticatedUser,
    headerValue: string | undefined,
    read: (snapshot: ScopeContextSnapshot) => Promise<T>,
  ): Promise<T> {
    const token = headerValue?.trim();
    if (!token) {
      throw contextRequired();
    }
    const presented = verifyPresentedContext(token);
    return this.prisma.$transaction(
      async (tx) => {
        const snapshot = await readSnapshotComponents(tx, user, presented);
        if (!componentsMatch(presented, snapshot)) {
          throw contextMismatch();
        }
        return read({ tx, siteId: snapshot.siteId });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}

async function readSnapshotComponents(
  tx: Prisma.TransactionClient,
  user: TenantAuthenticatedUser,
  presented: ScopeContextComponents,
): Promise<SnapshotComponents> {
  const tenantId = user.tenantId;
  const [endedLineage, member, tenant, siteId] = await Promise.all([
    tx.endedSessionLineage.findFirst({
      where: {
        tenant_id: tenantId,
        continuity_digest: presented.continuityDigest,
      },
      select: { id: true },
    }),
    tx.tenantMember.findFirst({
      where: {
        tenant_id: tenantId,
        user: { firebaseUid: user.userId },
        is_active: true,
      },
      select: { scope_epoch: true },
    }),
    tx.tenant.findFirst({
      where: { id: tenantId, is_active: true },
      select: { authorization_epoch: true },
    }),
    findValidatedActiveSiteIdForTenant(tx, user.userId, tenantId),
  ]);
  if (endedLineage) {
    throw new UnauthorizedException('Session lineage has ended.');
  }
  if (!member || !tenant) {
    throw new UnauthorizedException('Tenant membership is not active.');
  }
  if (!siteId) {
    throw new UnprocessableEntityException({
      statusCode: 422,
      code: 'ACTIVE_SITE_REQUIRED',
      message: 'An active site is required.',
    });
  }
  return {
    principalSub: user.userId,
    continuityDigests:
      user.authTimeSeconds === undefined
        ? []
        : continuityDigestCandidates(user.userId, user.authTimeSeconds),
    tenantId,
    siteId,
    scopeEpoch: member.scope_epoch,
    authorizationEpoch: tenant.authorization_epoch,
    policyVersion: getScopeContextPolicyDigest(),
  };
}

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditLogAction } from '@prisma/client';
import { AuditService } from '../../audit/audit.service.js';
import { isApiKeyPrincipal } from '../../auth/types/authenticated-user.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  TenantApiKeyCreatedResponseDto,
  TenantApiKeyListResponseDto,
  TenantApiKeyResponseDto,
  type CreateTenantApiKeyDto,
  type TenantApiKeyStatus,
} from './dto/tenant-api-key.dto.js';
import { resolveApiKeyPepper } from './api-key-pepper.js';
import {
  API_KEY_HASH_VERSION,
  buildApiKeyDisplayPrefix,
  createApiKeyCredentials,
  hashApiKeySecret,
} from './api-key-token.js';

export const TENANT_API_KEY_AUDIT_ENTITY_TYPE = 'TenantApiKey';
export const TENANT_API_KEY_AUDIT_SOURCE = 'tenant-api-keys';

const KEY_MANAGER_ROLES: ReadonlySet<string> = new Set(['OWNER', 'ADMIN']);
const KEY_MANAGER_DENIED_MESSAGE =
  'Only tenant owners and admins can manage API keys.';

type TenantApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: Date;
  last_used_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_by: { email: string } | null;
};

const CREATOR_INCLUDE = {
  created_by: { select: { email: true } },
} as const;

/**
 * Tenant API key management for OWNER and ADMIN sessions (ADR-0026). Keys are listed, created and
 * revoked here. Nothing in this service ever returns or logs a stored digest.
 */
@Injectable()
export class TenantApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async list(now: Date = new Date()): Promise<TenantApiKeyListResponseDto> {
    const { tenantId } = await this.assertKeyManager();

    const rows = await this.prisma.tenantApiKey.findMany({
      where: { tenant_id: tenantId },
      include: CREATOR_INCLUDE,
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    });

    return { data: rows.map((row) => toResponse(row, now)) };
  }

  /** Returns the full token once. Only its keyed digest and display prefix are persisted. */
  async create(
    dto: CreateTenantApiKeyDto,
    now: Date = new Date(),
  ): Promise<TenantApiKeyCreatedResponseDto> {
    const { tenantId, actorUserId } = await this.assertKeyManager();

    const pepper = resolveApiKeyPepper();
    if (!pepper) {
      throw new ServiceUnavailableException(
        'API keys are not configured for this environment.',
      );
    }

    const expiresAt = parseExpiry(dto.expiresAt, now);
    const credentials = createApiKeyCredentials();

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.tenantApiKey.create({
        data: {
          id: credentials.keyId,
          tenant_id: tenantId,
          name: dto.name.trim(),
          key_prefix: buildApiKeyDisplayPrefix(credentials.keyId),
          secret_hash: hashApiKeySecret(
            credentials.keyId,
            credentials.secret,
            pepper,
          ),
          hash_version: API_KEY_HASH_VERSION,
          scopes: [...dto.scopes],
          created_by_user_id: actorUserId,
          expires_at: expiresAt,
        },
        include: CREATOR_INCLUDE,
      });

      await this.audit.recordTenantMutation(
        {
          entityType: TENANT_API_KEY_AUDIT_ENTITY_TYPE,
          entityId: row.id,
          action: AuditLogAction.CREATE,
          actorUserId,
          source: TENANT_API_KEY_AUDIT_SOURCE,
          after: auditSnapshot(row),
        },
        tx,
      );

      return row;
    });

    return { ...toResponse(created, now), token: credentials.token };
  }

  /** Idempotent. Revocation takes effect on the next request, because every request re-reads the key row. */
  async revoke(
    id: string,
    now: Date = new Date(),
  ): Promise<TenantApiKeyResponseDto> {
    const { tenantId, actorUserId } = await this.assertKeyManager();

    const existing = await this.prisma.tenantApiKey.findFirst({
      where: { id, tenant_id: tenantId },
      include: CREATOR_INCLUDE,
    });
    if (!existing) {
      throw new NotFoundException('API key not found.');
    }
    if (existing.revoked_at) {
      return toResponse(existing, now);
    }

    const current = await this.prisma.$transaction(async (tx) => {
      const result = await tx.tenantApiKey.updateMany({
        where: { id, tenant_id: tenantId, revoked_at: null },
        data: { revoked_at: now, revoked_by_user_id: actorUserId },
      });
      const row = await tx.tenantApiKey.findFirstOrThrow({
        where: { id, tenant_id: tenantId },
        include: CREATOR_INCLUDE,
      });

      // A concurrent request revoked the key first. Return its state without a second audit entry.
      if (result.count === 1) {
        await this.audit.recordTenantMutation(
          {
            entityType: TENANT_API_KEY_AUDIT_ENTITY_TYPE,
            entityId: id,
            action: AuditLogAction.UPDATE,
            actorUserId,
            source: TENANT_API_KEY_AUDIT_SOURCE,
            before: { revokedAt: null },
            after: { revokedAt: now.toISOString() },
            diff: { revokedAt: { before: null, after: now.toISOString() } },
          },
          tx,
        );
      }

      return row;
    });

    return toResponse(current, now);
  }

  private async assertKeyManager(): Promise<{
    tenantId: string;
    actorUserId: string;
  }> {
    const user = this.tenantContext.getAuthenticatedUser();
    const tenantId = user?.tenantId;
    if (
      !user ||
      !tenantId ||
      isApiKeyPrincipal(user) ||
      !KEY_MANAGER_ROLES.has(user.role ?? '')
    ) {
      throw new ForbiddenException(KEY_MANAGER_DENIED_MESSAGE);
    }

    const actor = await this.prisma.user.findFirst({
      where: { firebaseUid: user.userId, active_tenant_id: tenantId },
      select: { id: true },
    });
    if (!actor) {
      throw new ForbiddenException(KEY_MANAGER_DENIED_MESSAGE);
    }

    return { tenantId, actorUserId: actor.id };
  }
}

function parseExpiry(value: string | undefined, now: Date): Date | null {
  if (value === undefined) {
    return null;
  }

  const expiresAt = new Date(value);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    throw new BadRequestException('expiresAt must be a date in the future.');
  }
  return expiresAt;
}

function statusOf(row: TenantApiKeyRow, now: Date): TenantApiKeyStatus {
  if (row.revoked_at) {
    return 'REVOKED';
  }
  if (row.expires_at && row.expires_at <= now) {
    return 'EXPIRED';
  }
  return 'ACTIVE';
}

function toResponse(row: TenantApiKeyRow, now: Date): TenantApiKeyResponseDto {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    status: statusOf(row, now),
    createdAt: row.created_at,
    createdByEmail: row.created_by?.email ?? null,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

/** Audit payload. Lists only identifying and scope fields, never the digest or the token. */
function auditSnapshot(row: TenantApiKeyRow) {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes,
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
  };
}

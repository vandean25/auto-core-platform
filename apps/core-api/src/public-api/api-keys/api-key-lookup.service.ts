import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../../prisma/system-prisma.service.js';

/** Key row read before any tenant context exists. Untrusted until the secret has been verified. */
export type ApiKeyVerificationRow = {
  id: string;
  tenant_id: string;
  key_prefix: string;
  secret_hash: string;
  hash_version: number;
  scopes: string[];
  expires_at: Date | null;
  revoked_at: Date | null;
  tenant: {
    is_active: boolean;
    api_rate_limit_per_minute: number;
  };
};

/**
 * The only pre-tenant read of tenant API keys (ADR-0026). It uses the unextended system client, because the
 * key row itself names the tenant and no tenant context exists yet. Every later query is tenant-scoped by
 * PrismaService. Keep this the single call site. The allow-list is in system-prisma.types.ts.
 */
@Injectable()
export class ApiKeyLookupService {
  constructor(private readonly systemPrisma: SystemPrismaService) {}

  async findForVerification(
    keyId: string,
  ): Promise<ApiKeyVerificationRow | null> {
    return this.systemPrisma.tenantApiKey.findUnique({
      where: { id: keyId },
      select: {
        id: true,
        tenant_id: true,
        key_prefix: true,
        secret_hash: true,
        hash_version: true,
        scopes: true,
        expires_at: true,
        revoked_at: true,
        tenant: {
          select: { is_active: true, api_rate_limit_per_minute: true },
        },
      },
    });
  }
}

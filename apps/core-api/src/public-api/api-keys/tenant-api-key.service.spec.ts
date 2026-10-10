import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuditLogAction } from '@prisma/client';
import { TenantApiKeyService } from './tenant-api-key.service.js';
import {
  API_KEY_HASH_VERSION,
  hashApiKeySecret,
  parseApiKeyToken,
  verifyApiKeySecret,
} from './api-key-token.js';

const PEPPER = Buffer.alloc(32, 9);
const NOW = new Date('2026-10-09T10:00:00.000Z');
const TENANT_ID = 'tenant-a';
const DB_USER_ID = 'user-owner-1';
const KEY_ID = '3f9a2c1b-7d4e-4f2a-9b8c-1234567890ab';

function ownerUser(role = 'OWNER') {
  return {
    userId: 'firebase-owner',
    email: 'owner@example.test',
    tenantId: TENANT_ID,
    role,
  };
}

function storedKey(overrides: Record<string, unknown> = {}) {
  return {
    id: KEY_ID,
    tenant_id: TENANT_ID,
    name: 'Warehouse dashboard',
    key_prefix: 'acp_live_3f9a2c1b',
    secret_hash: 'f'.repeat(64),
    hash_version: API_KEY_HASH_VERSION,
    scopes: ['customers:read'],
    created_by_user_id: DB_USER_ID,
    revoked_by_user_id: null,
    created_at: new Date('2026-10-01T08:00:00.000Z'),
    last_used_at: null,
    expires_at: null,
    revoked_at: null,
    created_by: { email: 'owner@example.test' },
    ...overrides,
  };
}

function createHarness(user: ReturnType<typeof ownerUser> | undefined) {
  const tenantApiKey = {
    create: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    updateMany: jest.fn(),
  };
  const transactionClient = { tenantApiKey };
  const prisma = {
    tenantApiKey,
    user: { findFirst: jest.fn().mockResolvedValue({ id: DB_USER_ID }) },
    $transaction: jest.fn(async (callback: (client: typeof transactionClient) => unknown) =>
      callback(transactionClient),
    ),
  };
  const tenantContext = {
    getAuthenticatedUser: jest.fn(() => user),
    getTenantId: jest.fn(async () => TENANT_ID),
  };
  const audit = { recordTenantMutation: jest.fn().mockResolvedValue(undefined) };
  const service = new TenantApiKeyService(
    prisma as never,
    tenantContext as never,
    audit as never,
  );
  return { service, prisma, tenantApiKey, transactionClient, audit };
}

describe('TenantApiKeyService', () => {
  const originalPepper = process.env.API_KEY_PEPPER;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.API_KEY_PEPPER = PEPPER.toString('base64');
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    restoreEnv('API_KEY_PEPPER', originalPepper);
    restoreEnv('NODE_ENV', originalNodeEnv);
  });

  describe('role gate (OWNER and ADMIN only)', () => {
    it.each(['TECH', 'SALES'])(
      'denies %s on list, create and revoke without touching the database',
      async (role) => {
        const { service, tenantApiKey, prisma } = createHarness(ownerUser(role));

        await expect(service.list(NOW)).rejects.toBeInstanceOf(ForbiddenException);
        await expect(
          service.create({ name: 'x', scopes: ['stock:read'] }, NOW),
        ).rejects.toBeInstanceOf(ForbiddenException);
        await expect(service.revoke(KEY_ID, NOW)).rejects.toBeInstanceOf(
          ForbiddenException,
        );

        expect(tenantApiKey.findMany).not.toHaveBeenCalled();
        expect(tenantApiKey.create).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it('denies a request without a tenant user', async () => {
      const { service } = createHarness(undefined);

      await expect(service.list(NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('denies an API-key principal from managing keys', async () => {
      const { service } = createHarness({
        ...ownerUser('API_KEY'),
        apiKeyId: KEY_ID,
      } as never);

      await expect(service.list(NOW)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(['OWNER', 'ADMIN'])('allows %s to list keys', async (role) => {
      const { service, tenantApiKey } = createHarness(ownerUser(role));
      tenantApiKey.findMany.mockResolvedValue([storedKey()]);

      await expect(service.list(NOW)).resolves.toEqual({
        data: [expect.objectContaining({ id: KEY_ID, status: 'ACTIVE' })],
      });
    });
  });

  describe('create', () => {
    it('returns the secret exactly once and persists only its keyed digest and display prefix', async () => {
      const { service, transactionClient, audit } = createHarness(ownerUser());
      transactionClient.tenantApiKey.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) =>
          storedKey({
            id: data.id,
            name: data.name,
            key_prefix: data.key_prefix,
            secret_hash: data.secret_hash,
            scopes: data.scopes,
            created_at: NOW,
          }),
      );

      const created = await service.create(
        { name: '  Warehouse dashboard  ', scopes: ['customers:read'] },
        NOW,
      );

      const persisted = transactionClient.tenantApiKey.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(persisted.data).toEqual(
        expect.objectContaining({
          tenant_id: TENANT_ID,
          name: 'Warehouse dashboard',
          scopes: ['customers:read'],
          created_by_user_id: DB_USER_ID,
          hash_version: API_KEY_HASH_VERSION,
        }),
      );
      const keyId = String(persisted.data.id);
      expect(persisted.data.key_prefix).toBe(`acp_live_${keyId.slice(0, 8)}`);

      const parsed = parseApiKeyToken(created.token);
      expect(parsed?.keyId).toBe(keyId);
      const secret = parsed?.secret ?? '';
      expect(
        await verifyApiKeySecret(keyId, secret, String(persisted.data.secret_hash), PEPPER),
      ).toBe(true);
      expect(await hashApiKeySecret(keyId, secret, PEPPER)).toBe(persisted.data.secret_hash);

      // The plaintext secret and the digest must not reach the database row or the audit trail.
      expect(JSON.stringify(persisted.data)).not.toContain(secret);
      const auditPayload = JSON.stringify(audit.recordTenantMutation.mock.calls);
      expect(auditPayload).not.toContain(secret);
      expect(auditPayload).not.toContain(String(persisted.data.secret_hash));
    });

    it('writes an audit CREATE entry for the key and nothing secret', async () => {
      const { service, transactionClient, audit } = createHarness(ownerUser());
      transactionClient.tenantApiKey.create.mockImplementation(
        async ({ data }: { data: Record<string, unknown> }) =>
          storedKey({ id: data.id, created_at: NOW }),
      );

      const created = await service.create({ name: 'Audit me', scopes: ['stock:read'] }, NOW);

      expect(audit.recordTenantMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'TenantApiKey',
          entityId: created.id,
          action: AuditLogAction.CREATE,
          actorUserId: DB_USER_ID,
          after: expect.objectContaining({ id: created.id, scopes: expect.any(Array) }),
        }),
        transactionClient,
      );
      const auditPayload = JSON.stringify(audit.recordTenantMutation.mock.calls[0]);
      expect(auditPayload).not.toContain('secret_hash');
      expect(auditPayload).not.toContain(created.token);
    });

    it('fails closed with 503 when the pepper is not configured', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.API_KEY_PEPPER;
      const { service, prisma } = createHarness(ownerUser());

      await expect(
        service.create({ name: 'x', scopes: ['stock:read'] }, NOW),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an expiry that is not in the future', async () => {
      const { service, prisma } = createHarness(ownerUser());

      await expect(
        service.create(
          { name: 'x', scopes: ['stock:read'], expiresAt: '2026-01-01T00:00:00.000Z' },
          NOW,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('sets revoked_at and the revoking user, then writes an UPDATE audit entry', async () => {
      const { service, tenantApiKey, transactionClient, audit } = createHarness(ownerUser());
      tenantApiKey.findFirst.mockResolvedValue(storedKey());
      tenantApiKey.updateMany.mockResolvedValue({ count: 1 });
      tenantApiKey.findFirstOrThrow.mockResolvedValue(storedKey({ revoked_at: NOW }));

      const result = await service.revoke(KEY_ID, NOW);

      expect(tenantApiKey.updateMany).toHaveBeenCalledWith({
        where: { id: KEY_ID, tenant_id: TENANT_ID, revoked_at: null },
        data: { revoked_at: NOW, revoked_by_user_id: DB_USER_ID },
      });
      expect(audit.recordTenantMutation).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditLogAction.UPDATE, entityId: KEY_ID }),
        transactionClient,
      );
      expect(result.status).toBe('REVOKED');
    });

    it('is idempotent for a key that is already revoked: no write and no second audit entry', async () => {
      const { service, tenantApiKey, audit } = createHarness(ownerUser());
      tenantApiKey.findFirst.mockResolvedValue(storedKey({ revoked_at: NOW }));

      const result = await service.revoke(KEY_ID, NOW);

      expect(tenantApiKey.updateMany).not.toHaveBeenCalled();
      expect(audit.recordTenantMutation).not.toHaveBeenCalled();
      expect(result.status).toBe('REVOKED');
    });

    it('answers 404 for a key id that does not belong to the caller tenant', async () => {
      const { service, tenantApiKey } = createHarness(ownerUser());
      tenantApiKey.findFirst.mockResolvedValue(null);

      await expect(service.revoke(KEY_ID, NOW)).rejects.toBeInstanceOf(NotFoundException);
      expect(tenantApiKey.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: KEY_ID, tenant_id: TENANT_ID } }),
      );
    });
  });

  describe('status projection', () => {
    it('reports EXPIRED for a key past its expiry and never exposes the digest', async () => {
      const { service, tenantApiKey } = createHarness(ownerUser());
      tenantApiKey.findMany.mockResolvedValue([
        storedKey({ expires_at: new Date('2026-01-01T00:00:00.000Z') }),
      ]);

      const response = await service.list(NOW);

      expect(response.data[0]?.status).toBe('EXPIRED');
      expect(JSON.stringify(response)).not.toContain('secret_hash');
      expect(JSON.stringify(response)).not.toContain('f'.repeat(64));
    });
  });
});

function restoreEnv(key: 'API_KEY_PEPPER' | 'NODE_ENV', value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

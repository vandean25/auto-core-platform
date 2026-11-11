import { describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ScopeContextLogoutService } from './scope-context-logout.service.js';
import { EndedSessionLineageService } from './ended-session-lineage.service.js';
import { SystemPrismaService } from '../../prisma/system-prisma.service.js';
import { SCOPE_CONTEXT_IDP_PORT } from './scope-context-idp.port.js';

describe('ScopeContextLogoutService (AUT-937)', () => {
  it('returns 503 when scope context HMAC is not configured', async () => {
    const previous = process.env.SCOPE_CONTEXT_HMAC_SECRET;
    delete process.env.SCOPE_CONTEXT_HMAC_SECRET;
    try {
      const moduleRef = await Test.createTestingModule({
        providers: [
          ScopeContextLogoutService,
          {
            provide: EndedSessionLineageService,
            useValue: { recordEndedLineageForMemberships: jest.fn() },
          },
          {
            provide: SystemPrismaService,
            useValue: { tenantMember: { findMany: jest.fn() } },
          },
          {
            provide: SCOPE_CONTEXT_IDP_PORT,
            useValue: {
              verifyIdTokenWithRevocation: jest.fn(async () => ({
                sub: 'uid',
                authTimeSeconds: 1_700_000_000,
              })),
            },
          },
        ],
      }).compile();

      const service = moduleRef.get(ScopeContextLogoutService);
      await expect(
        service.logout(
          {
            userId: 'uid',
            email: 'u@example.com',
            tenantId: 'tenant-a',
            role: 'ADMIN',
          },
          'token',
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      if (previous !== undefined) {
        process.env.SCOPE_CONTEXT_HMAC_SECRET = previous;
      }
    }
  });
});

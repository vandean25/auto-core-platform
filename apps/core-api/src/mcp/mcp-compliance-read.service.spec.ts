import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import type { CustomerConsentService } from '../customer-consent/customer-consent.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { McpComplianceReadService } from './mcp-compliance-read.service.js';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000c1';

function buildContact(options: { role?: string; customerExists?: boolean }) {
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(TENANT_A),
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role: options.role ?? 'SALES',
      userId: 'firebase-uid',
      tenantId: TENANT_A,
    }),
  };
  const prisma = {
    customer: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.customerExists === false ? null : { id: CUSTOMER_ID },
        ),
    },
  };
  const customerConsent = {
    evaluateCanContactForCustomer: jest.fn().mockResolvedValue({
      allowed: false,
      reason: 'MARKETING_PERMISSION_MISSING',
    }),
  };

  const service = new McpComplianceReadService(
    tenantContext as unknown as TenantContextService,
    prisma as unknown as PrismaService,
    customerConsent as unknown as CustomerConsentService,
  );

  return { service, customerConsent };
}

describe('McpComplianceReadService.checkContactPermission', () => {
  it('returns allowed and reason without ledger fields', async () => {
    const { service, customerConsent } = buildContact({});

    const result = await service.checkContactPermission({
      customer_id: CUSTOMER_ID,
      purpose: 'NEWSLETTER',
      channel: 'EMAIL',
    });

    expect(result).toEqual({
      customer_id: CUSTOMER_ID,
      purpose: 'NEWSLETTER',
      channel: 'EMAIL',
      allowed: false,
      reason: 'MARKETING_PERMISSION_MISSING',
    });
    expect(customerConsent.evaluateCanContactForCustomer).toHaveBeenCalledWith(
      CUSTOMER_ID,
      'EMAIL',
      'NEWSLETTER',
      undefined,
    );
    expect(result).not.toHaveProperty('text_snapshot');
  });

  it('rejects TECH callers like the consent ledger REST API', async () => {
    const { service } = buildContact({ role: 'TECH' });

    await expect(
      service.checkContactPermission({
        customer_id: CUSTOMER_ID,
        purpose: 'ORDER_COMMUNICATION',
        channel: 'EMAIL',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns not found when the customer is outside the tenant', async () => {
    const { service } = buildContact({ customerExists: false });

    await expect(
      service.checkContactPermission({
        customer_id: CUSTOMER_ID,
        purpose: 'ORDER_COMMUNICATION',
        channel: 'EMAIL',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

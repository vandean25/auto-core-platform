import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  assertConsentLedgerAccess,
  assertCustomerInTenant,
} from '../customer-consent/customer-consent.controller-context.js';
import { CustomerConsentService } from '../customer-consent/customer-consent.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { checkContactPermissionInputSchema } from './mcp-tool-schemas.compliance-reads.js';

type CheckContactInput = z.infer<typeof checkContactPermissionInputSchema>;

@Injectable()
export class McpComplianceReadService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly customerConsent: CustomerConsentService,
  ) {}

  async checkContactPermission(input: CheckContactInput) {
    assertConsentLedgerAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await assertCustomerInTenant(this.prisma, tenantId, input.customer_id);
    const decision = await this.customerConsent.evaluateCanContactForCustomer(
      input.customer_id,
      input.channel,
      input.purpose,
      input.controller_legal_entity_id,
    );
    return {
      customer_id: input.customer_id,
      purpose: input.purpose,
      channel: input.channel,
      allowed: decision.allowed,
      reason: decision.reason,
    };
  }
}

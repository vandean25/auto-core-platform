import type {
  CustomerConsentChannel,
  CustomerConsentPurpose,
  Prisma,
} from '@prisma/client';
import { consentProofRetainUntil } from './customer-consent-retention-core.helpers.js';

export { consentProofRetainUntil } from './customer-consent-retention-core.helpers.js';

export async function stampProofChainRetainUntil(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    controllerLegalEntityId: string;
    customerId: string;
    channel: CustomerConsentChannel;
    purposes: CustomerConsentPurpose[];
    cessationAt: Date;
  },
): Promise<void> {
  const retainUntil = consentProofRetainUntil(params.cessationAt);
  await tx.customerConsent.updateMany({
    where: {
      tenant_id: params.tenantId,
      controller_legal_entity_id: params.controllerLegalEntityId,
      customer_id: params.customerId,
      channel: params.channel,
      purpose: { in: params.purposes },
    },
    data: { retain_until: retainUntil },
  });
}

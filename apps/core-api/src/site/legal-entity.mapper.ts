import type { LegalEntity } from '@prisma/client';
import { computeSellerReadiness } from './legal-entity-readiness.js';

export type LegalEntityResponse = LegalEntity & {
  seller_readiness: {
    is_ready: boolean;
    missing_fields: string[];
  };
};

export function toLegalEntityResponse(
  entity: LegalEntity,
): LegalEntityResponse {
  const readiness = computeSellerReadiness(entity);

  return {
    ...entity,
    seller_readiness: {
      is_ready: readiness.isReady,
      missing_fields: readiness.missingFields,
    },
  };
}

import { createHash } from 'node:crypto';
import type { Autoscout24DmsListingPayload } from './autoscout24-dms-api.types.js';

export function digestAutoscout24DmsPushPayload(
  payload: Autoscout24DmsListingPayload,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        action: payload.action,
        sellerListingRef: payload.sellerListingRef,
        title: payload.title,
        priceGrossEur: payload.priceGrossEur,
      }),
    )
    .digest('hex');
}

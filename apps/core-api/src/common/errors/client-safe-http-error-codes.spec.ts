import { WARRANTY_CLAIM_ERROR_CODES } from '../../warranty-claim/warranty-claim.rules.js';
import {
  CLIENT_SAFE_HTTP_ERROR_CODES,
  pickClientSafeHttpErrorDetails,
} from './client-safe-http-error-codes.js';

describe('client-safe HTTP error codes', () => {
  // The global filter drops any code that is not in this set, so a warranty code missing here would never reach
  // the client. This keeps the two lists in step.
  it('lists every warranty claim code', () => {
    for (const code of Object.values(WARRANTY_CLAIM_ERROR_CODES)) {
      expect(CLIENT_SAFE_HTTP_ERROR_CODES.has(code)).toBe(true);
    }
  });

  it('lists the free-text part line code so agents and clients can tell it apart from a site error', () => {
    expect(CLIENT_SAFE_HTTP_ERROR_CODES.has('NOT_A_CATALOG_LINE')).toBe(true);
  });

  it('lists the active-order conflict code and forwards only its order ids', () => {
    expect(CLIENT_SAFE_HTTP_ERROR_CODES.has('VEHICLE_HAS_ACTIVE_ORDER')).toBe(true);
    expect(
      pickClientSafeHttpErrorDetails({
        code: 'VEHICLE_HAS_ACTIVE_ORDER',
        message: 'Vehicle already has active order WO-2026-0007',
        orderId: 'wo-live',
        orderNumber: 'WO-2026-0007',
        internalNote: 'not for the client',
      }),
    ).toEqual({ orderId: 'wo-live', orderNumber: 'WO-2026-0007' });
  });

  it('lists the estimate send gates the advisor dialog maps to German copy', () => {
    for (const code of [
      'ESTIMATE_NOT_DRAFT',
      'ESTIMATE_NO_LINES',
      'ESTIMATE_CUSTOMER_REQUIRED',
      'ESTIMATE_CUSTOMER_INCOMPLETE',
      'SELLER_IDENTITY_INCOMPLETE',
      'WORKSHOP_ORDER_NOT_ESTIMATABLE',
      'ESTIMATE_ROLE_FORBIDDEN',
    ]) {
      expect(CLIENT_SAFE_HTTP_ERROR_CODES.has(code)).toBe(true);
    }
  });

  it('forwards no detail fields for codes outside the allowlist', () => {
    expect(
      pickClientSafeHttpErrorDetails({ code: 'SOMETHING_ELSE', orderId: 'wo-live' }),
    ).toEqual({});
  });
});

import { WARRANTY_CLAIM_ERROR_CODES } from '../../warranty-claim/warranty-claim.rules.js';
import { CLIENT_SAFE_HTTP_ERROR_CODES } from './client-safe-http-error-codes.js';

describe('client-safe HTTP error codes', () => {
  // The global filter drops any code that is not in this set, so a warranty code missing here would never reach
  // the client. This keeps the two lists in step.
  it('lists every warranty claim code', () => {
    for (const code of Object.values(WARRANTY_CLAIM_ERROR_CODES)) {
      expect(CLIENT_SAFE_HTTP_ERROR_CODES.has(code)).toBe(true);
    }
  });
});

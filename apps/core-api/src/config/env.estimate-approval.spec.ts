import { EnvValidationError, validateEnv } from './env.js';

// The boot check runs in every environment, including test, so these cases use the test environment directly.
const SEND_ON = { NODE_ENV: 'test', CUSTOMER_ESTIMATE_SEND_ENABLED: 'true' };

function refusalFor(env: NodeJS.ProcessEnv): EnvValidationError {
  try {
    validateEnv(env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the boot check to refuse the environment');
}

describe('validateEnv estimate approval base (ADR-0025 §7)', () => {
  it('refuses an enabled estimate send without the approval base, outside production too', () => {
    expect(refusalFor(SEND_ON).missing).toContain('ESTIMATE_APPROVAL_BASE_URL');
  });

  it.each([
    ['plain http', 'http://portal.example.at'],
    ['a trailing query', 'https://portal.example.at/?ref=1'],
    ['credentials', 'https://user:secret@portal.example.at'],
    ['a space inside', 'https://portal .example.at'],
  ])('refuses an approval base with %s', (_label, base) => {
    expect(
      refusalFor({ ...SEND_ON, ESTIMATE_APPROVAL_BASE_URL: base }).invalid,
    ).toContain('ESTIMATE_APPROVAL_BASE_URL');
  });

  it('accepts a usable https base, and asks for none while the send is off', () => {
    expect(() =>
      validateEnv({
        ...SEND_ON,
        ESTIMATE_APPROVAL_BASE_URL: 'https://portal.example.at',
      }),
    ).not.toThrow();
    expect(() => validateEnv({ NODE_ENV: 'test' })).not.toThrow();
  });
});

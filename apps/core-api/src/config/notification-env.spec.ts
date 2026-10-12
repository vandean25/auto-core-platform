import { EnvValidationError, validateEnv } from './env.js';
import { notificationEnvIssues } from './notification-env.js';

const VALID_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');

const developmentEnv = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/core',
  SECRET_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
  CATALOG_HIT_HMAC_SECRET: 'catalog-hit-development-secret',
  ...overrides,
});

function envErrorFor(env: NodeJS.ProcessEnv): EnvValidationError {
  try {
    validateEnv(env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected EnvValidationError');
}

describe('notification sender environment (AUT-356)', () => {
  describe('notificationEnvIssues()', () => {
    it('reports nothing when the sender is unconfigured, which means off', () => {
      expect(notificationEnvIssues({ NODE_ENV: 'production' })).toEqual([]);
    });

    it('rejects a sender address that is not one plain address', () => {
      expect(
        notificationEnvIssues({
          NODE_ENV: 'development',
          NOTIFICATION_EMAIL_MODE: 'fake',
          NOTIFICATION_EMAIL_FROM_ADDRESS:
            'kontakt@example.at, bcc@evil.example',
        }),
      ).toEqual([{ key: 'NOTIFICATION_EMAIL_FROM_ADDRESS', kind: 'invalid' }]);
    });

    it('rejects an unknown mode', () => {
      expect(
        notificationEnvIssues({
          NODE_ENV: 'development',
          NOTIFICATION_EMAIL_MODE: 'on',
        }),
      ).toEqual([{ key: 'NOTIFICATION_EMAIL_MODE', kind: 'invalid' }]);
    });

    it('refuses fake mode in production but allows it elsewhere', () => {
      const sender = 'kontakt@example.at';
      expect(
        notificationEnvIssues({
          NODE_ENV: 'production',
          NOTIFICATION_EMAIL_MODE: 'fake',
          NOTIFICATION_EMAIL_FROM_ADDRESS: sender,
        }),
      ).toEqual([{ key: 'NOTIFICATION_EMAIL_MODE', kind: 'invalid' }]);
      expect(
        notificationEnvIssues({
          NODE_ENV: 'development',
          NOTIFICATION_EMAIL_MODE: 'fake',
          NOTIFICATION_EMAIL_FROM_ADDRESS: sender,
        }),
      ).toEqual([]);
    });

    it('requires a sender address once sending is enabled, outside tests', () => {
      expect(
        notificationEnvIssues({
          NODE_ENV: 'development',
          NOTIFICATION_EMAIL_MODE: 'live',
        }),
      ).toEqual([{ key: 'NOTIFICATION_EMAIL_FROM_ADDRESS', kind: 'required' }]);
      expect(
        notificationEnvIssues({
          NODE_ENV: 'test',
          NOTIFICATION_EMAIL_MODE: 'live',
        }),
      ).toEqual([]);
    });

    it('rejects a malformed allowlist entry and an unknown live provider', () => {
      expect(
        notificationEnvIssues({
          NODE_ENV: 'development',
          NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST: 'not-an-address',
        }),
      ).toEqual([
        { key: 'NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST', kind: 'invalid' },
      ]);
      expect(
        notificationEnvIssues({
          NODE_ENV: 'development',
          NOTIFICATION_EMAIL_PROVIDER: 'mailgun',
        }),
      ).toEqual([{ key: 'NOTIFICATION_EMAIL_PROVIDER', kind: 'invalid' }]);
    });

    it('accepts a complete live configuration', () => {
      expect(
        notificationEnvIssues({
          NODE_ENV: 'production',
          NOTIFICATION_EMAIL_MODE: 'live',
          NOTIFICATION_EMAIL_PROVIDER: 'ses',
          NOTIFICATION_EMAIL_RECIPIENT_ALLOWLIST:
            'kunde@example.at,*@test.example.at',
          NOTIFICATION_EMAIL_FROM_ADDRESS: 'kontakt@example.at',
        }),
      ).toEqual([]);
    });
  });

  describe('validateEnv()', () => {
    it('boots with the sender unconfigured', () => {
      expect(() => validateEnv(developmentEnv())).not.toThrow();
    });

    it('stops boot on a bad mode and names the key', () => {
      expect(
        envErrorFor(developmentEnv({ NOTIFICATION_EMAIL_MODE: 'on' })).invalid,
      ).toContain('NOTIFICATION_EMAIL_MODE');
    });

    it('names the missing sender address once live sending is enabled', () => {
      expect(
        envErrorFor(developmentEnv({ NOTIFICATION_EMAIL_MODE: 'live' }))
          .missing,
      ).toContain('NOTIFICATION_EMAIL_FROM_ADDRESS');
    });

    it('treats a blank value as unset', () => {
      expect(() =>
        validateEnv(developmentEnv({ NOTIFICATION_EMAIL_MODE: '   ' })),
      ).not.toThrow();
    });
  });
});

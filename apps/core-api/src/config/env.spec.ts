import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DOCUMENTED_ENV_KEYS,
  EnvValidationError,
  validateEnv,
} from './env';

const VALID_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
const SHORT_ENCRYPTION_KEY = Buffer.alloc(16, 9).toString('base64');

function productionEnv(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/core',
    FIREBASE_PROJECT_ID: 'auto-core-platform',
    SECRET_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
    FRONTEND_URL: 'https://app.example.com',
    CLOUD_TASKS_ENABLED: 'false',
    ...overrides,
  };
}

describe('validateEnv', () => {
  it('throws a single production error listing every missing required variable', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        CLOUD_TASKS_ENABLED: 'true',
      }),
    ).toThrow(EnvValidationError);

    const validationError = expectEnvError({
      NODE_ENV: 'production',
      CLOUD_TASKS_ENABLED: 'true',
    });
    expect(validationError.missing).toEqual([
      'DATABASE_URL',
      'SECRET_ENCRYPTION_KEY',
      'FIREBASE_PROJECT_ID',
      'FRONTEND_URL',
      'CLOUD_TASKS_WORKER_SECRET',
    ]);
    expect(validationError.message).toContain('DATABASE_URL');
    expect(validationError.message).toContain('SECRET_ENCRYPTION_KEY');
    expect(validationError.message).toContain('FIREBASE_PROJECT_ID');
    expect(validationError.message).toContain('FRONTEND_URL');
    expect(validationError.message).toContain('CLOUD_TASKS_WORKER_SECRET');
  });

  it('treats blank production values as missing', () => {
    const validationError = expectEnvError(
      productionEnv({
        DATABASE_URL: '   ',
        FIREBASE_PROJECT_ID: '',
      }),
    );
    expect(validationError.missing).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'FIREBASE_PROJECT_ID']),
    );
  });

  it('accepts GOOGLE_CLOUD_PROJECT when FIREBASE_PROJECT_ID is unset in production', () => {
    expect(() =>
      validateEnv(
        productionEnv({
          FIREBASE_PROJECT_ID: undefined,
          GOOGLE_CLOUD_PROJECT: 'auto-core-platform',
        }),
      ),
    ).not.toThrow();
  });

  it('requires CLOUD_TASKS_WORKER_SECRET when PDF workers are enabled', () => {
    expect(() =>
      validateEnv(
        productionEnv({
          CLOUD_TASKS_ENABLED: 'true',
        }),
      ),
    ).toThrow(/CLOUD_TASKS_WORKER_SECRET/);
  });

  it('requires CLOUD_TASKS_WORKER_SECRET in production when a Cloud Tasks queue is configured', () => {
    expect(() =>
      validateEnv(
        productionEnv({
          CLOUD_TASKS_ENABLED: undefined,
          CLOUD_TASKS_LOCATION: 'europe-west3',
          CLOUD_TASKS_QUEUE: 'pdf-queue',
        }),
      ),
    ).toThrow(/CLOUD_TASKS_WORKER_SECRET/);
  });

  it('does not require CLOUD_TASKS_WORKER_SECRET in production when PDF workers are disabled', () => {
    expect(() => validateEnv(productionEnv())).not.toThrow();
  });

  it('rejects SECRET_ENCRYPTION_KEY values that are not 32-byte base64', () => {
    const validationError = expectEnvError(
      productionEnv({
        SECRET_ENCRYPTION_KEY: SHORT_ENCRYPTION_KEY,
      }),
    );
    expect(validationError.invalid).toContain('SECRET_ENCRYPTION_KEY');
    expect(validationError.message).toMatch(/base64-encoded 32-byte key/);
  });

  it('requires DATABASE_URL and SECRET_ENCRYPTION_KEY in development', () => {
    const validationError = expectEnvError({ NODE_ENV: 'development' });
    expect(validationError.missing).toEqual([
      'DATABASE_URL',
      'SECRET_ENCRYPTION_KEY',
    ]);
  });

  it('does not require Firebase, FRONTEND_URL, or worker secret in development', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/core',
        SECRET_ENCRYPTION_KEY: VALID_ENCRYPTION_KEY,
      }),
    ).not.toThrow();
  });

  it('allows the existing test/e2e fixture env with no production secrets', () => {
    expect(() => validateEnv({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => validateEnv({ NODE_ENV: 'test', DATABASE_URL: '' })).not.toThrow();
  });
});

describe('DOCUMENTED_ENV_KEYS', () => {
  it('matches keys documented in .env.example', () => {
    const examplePath = join(__dirname, '../../.env.example');
    const example = readFileSync(examplePath, 'utf8');
    const exampleKeys = new Set(
      [...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(
        (match) => match[1],
      ),
    );

    expect([...DOCUMENTED_ENV_KEYS].sort()).toEqual(
      [...exampleKeys].sort(),
    );
  });
});

function expectEnvError(env: NodeJS.ProcessEnv): EnvValidationError {
  try {
    validateEnv(env);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);
    return error as EnvValidationError;
  }
  throw new Error('expected EnvValidationError');
}

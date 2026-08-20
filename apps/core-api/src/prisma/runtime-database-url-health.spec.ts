import {
  inspectRuntimeDatabaseUrls,
  logRuntimeDatabaseUrlStatus,
  requireRuntimePooler,
} from './runtime-database-url-health';

describe('inspectRuntimeDatabaseUrls', () => {
  it('identifies a distinct Neon pooler host', () => {
    const status = inspectRuntimeDatabaseUrls({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:direct@ep-direct.eu.neon.tech/core',
      DATABASE_URL_POOLED:
        'postgresql://user:pooled@ep-direct-pooler.eu.neon.tech/core',
    });

    expect(status.pooledHostContainsPooler).toBe(true);
    expect(status.pooledHostEqualsDirect).toBe(false);
    expect(status.mismatch).toBe(false);
  });

  it('marks equal direct and pooled hosts as a mismatch', () => {
    const status = inspectRuntimeDatabaseUrls({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:direct@ep-main.eu.neon.tech/core',
      DATABASE_URL_POOLED: 'postgresql://user:pooled@ep-main.eu.neon.tech/core',
    });

    expect(status.pooledHostEqualsDirect).toBe(true);
    expect(status.mismatch).toBe(true);
  });

  it('marks a blank pooled URL as a mismatch', () => {
    const status = inspectRuntimeDatabaseUrls({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:direct@ep-main.eu.neon.tech/core',
      DATABASE_URL_POOLED: '   ',
    });

    expect(status.pooledConfigured).toBe(false);
    expect(status.mismatch).toBe(true);
  });

  it('marks a valid non-pooler host as a mismatch', () => {
    const status = inspectRuntimeDatabaseUrls({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:direct@ep-direct.eu.neon.tech/core',
      DATABASE_URL_POOLED:
        'postgresql://user:pooled@ep-other.eu.neon.tech/core',
    });

    expect(status.pooledHostContainsPooler).toBe(false);
    expect(status.mismatch).toBe(true);
  });

  it('marks a malformed pooled URL as a mismatch', () => {
    const status = inspectRuntimeDatabaseUrls({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:direct@ep-direct.eu.neon.tech/core',
      DATABASE_URL_POOLED: 'not-a-database-url',
    });

    expect(status.pooledConfigured).toBe(true);
    expect(status.pooledHost).toBeUndefined();
    expect(status.mismatch).toBe(true);
  });
});

describe('requireRuntimePooler', () => {
  it('does not throw by default for a production mismatch', () => {
    expect(() =>
      requireRuntimePooler(
        inspectRuntimeDatabaseUrls({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://user:direct@ep-main.eu.neon.tech/core',
          DATABASE_URL_POOLED:
            'postgresql://user:pooled@ep-main.eu.neon.tech/core',
        }),
      ),
    ).not.toThrow();
  });

  it('throws when production explicitly requires a pooler', () => {
    expect(() =>
      requireRuntimePooler(
        inspectRuntimeDatabaseUrls({
          NODE_ENV: 'production',
          DATABASE_POOLER_REQUIRED: 'true',
          DATABASE_URL: 'postgresql://user:direct@ep-main.eu.neon.tech/core',
          DATABASE_URL_POOLED:
            'postgresql://user:pooled@ep-main.eu.neon.tech/core',
        }),
      ),
    ).toThrow(/DATABASE_POOLER_REQUIRED/);
  });
});

describe('logRuntimeDatabaseUrlStatus', () => {
  it('logs a credential-free warning for a production mismatch', () => {
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
    };

    logRuntimeDatabaseUrlStatus(
      inspectRuntimeDatabaseUrls({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:direct@ep-main.eu.neon.tech/core',
        DATABASE_URL_POOLED:
          'postgresql://user:pooled@ep-main.eu.neon.tech/core',
      }),
      logger,
    );

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).not.toContain('user:direct');
    expect(logger.warn.mock.calls[0][0]).not.toContain('user:pooled');
  });

  it('keeps host fields in the structured event when a URL is invalid', () => {
    const logger = {
      log: jest.fn(),
      warn: jest.fn(),
    };

    logRuntimeDatabaseUrlStatus(
      inspectRuntimeDatabaseUrls({
        NODE_ENV: 'production',
        DATABASE_URL: 'not-a-database-url',
        DATABASE_URL_POOLED: 'also-not-a-database-url',
      }),
      logger,
    );

    expect(JSON.parse(logger.warn.mock.calls[0][0])).toEqual(
      expect.objectContaining({
        directHost: null,
        pooledHost: null,
      }),
    );
  });
});

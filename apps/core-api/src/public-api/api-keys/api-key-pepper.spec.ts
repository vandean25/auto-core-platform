import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { resolveApiKeyPepper } from './api-key-pepper.js';

describe('resolveApiKeyPepper', () => {
  const originalPepper = process.env.API_KEY_PEPPER;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    delete process.env.API_KEY_PEPPER;
  });

  afterEach(() => {
    restore('API_KEY_PEPPER', originalPepper);
    restore('NODE_ENV', originalNodeEnv);
  });

  it('decodes a configured base64 pepper of at least 32 bytes', () => {
    const raw = Buffer.alloc(32, 7);
    process.env.API_KEY_PEPPER = raw.toString('base64');
    process.env.NODE_ENV = 'production';

    expect(resolveApiKeyPepper()?.equals(raw)).toBe(true);
  });

  it('fails closed (undefined) outside tests when the pepper is unset', () => {
    process.env.NODE_ENV = 'production';

    expect(resolveApiKeyPepper()).toBeUndefined();
  });

  it('fails closed when the configured pepper is too short', () => {
    process.env.API_KEY_PEPPER = Buffer.alloc(16, 1).toString('base64');
    process.env.NODE_ENV = 'production';

    expect(resolveApiKeyPepper()).toBeUndefined();
  });

  it('uses a stable per-process random pepper in tests when unset', () => {
    process.env.NODE_ENV = 'test';

    const first = resolveApiKeyPepper();
    const second = resolveApiKeyPepper();

    expect(first?.length).toBe(32);
    expect(second?.equals(first as Buffer)).toBe(true);
  });
});

function restore(key: 'API_KEY_PEPPER' | 'NODE_ENV', value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

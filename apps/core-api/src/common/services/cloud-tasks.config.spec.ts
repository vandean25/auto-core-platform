import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  getRequiredCloudTasksEnv,
  isCloudTasksEnabled,
} from './cloud-tasks.config.js';

const CONFIGURED_ENV = {
  CLOUD_TASKS_WORKER_SECRET: 'worker-secret',
  CLOUD_TASKS_LOCATION: 'europe-west3',
  CLOUD_TASKS_QUEUE: 'pdf-queue',
  CLOUD_TASKS_INVOKER_SA: 'invoker@example.test',
};

describe('getRequiredCloudTasksEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...CONFIGURED_ENV };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns the four Cloud Tasks settings when all are present', () => {
    expect(getRequiredCloudTasksEnv()).toEqual({
      workerSecret: 'worker-secret',
      location: 'europe-west3',
      queue: 'pdf-queue',
      invokerServiceAccount: 'invoker@example.test',
    });
  });

  it.each(Object.keys(CONFIGURED_ENV))('throws when %s is missing', (key) => {
    delete process.env[key];

    expect(() => getRequiredCloudTasksEnv()).toThrow(
      'Cloud Tasks is missing required configuration environment variables',
    );
  });
});

describe('isCloudTasksEnabled', () => {
  it('is false when any of the four required settings is empty', () => {
    for (const key of Object.keys(CONFIGURED_ENV)) {
      const env = {
        ...CONFIGURED_ENV,
        CLOUD_TASKS_ENABLED: 'true',
        [key]: '',
      };

      expect(isCloudTasksEnabled(env)).toBe(false);
    }
  });

  it('honours an explicit CLOUD_TASKS_ENABLED flag', () => {
    expect(
      isCloudTasksEnabled({
        ...CONFIGURED_ENV,
        CLOUD_TASKS_ENABLED: 'true',
        NODE_ENV: 'development',
      }),
    ).toBe(true);
    expect(
      isCloudTasksEnabled({
        ...CONFIGURED_ENV,
        CLOUD_TASKS_ENABLED: 'false',
        NODE_ENV: 'production',
      }),
    ).toBe(false);
  });

  it('is enabled by default only in production when the flag is unset', () => {
    expect(
      isCloudTasksEnabled({ ...CONFIGURED_ENV, NODE_ENV: 'production' }),
    ).toBe(true);
    expect(isCloudTasksEnabled({ ...CONFIGURED_ENV, NODE_ENV: 'test' })).toBe(
      false,
    );
  });
});

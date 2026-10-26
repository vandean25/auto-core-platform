import { resolveImportWorkerTargetBaseUrl } from './import-worker-target.js';

describe('resolveImportWorkerTargetBaseUrl', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL;
    delete process.env.CLOUD_TASKS_TARGET_BASE_URL;
  });

  afterAll(() => {
    process.env = env;
  });

  it('prefers the notification (core-api) base URL', () => {
    process.env.CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL =
      'https://core.example/api';
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'https://pdf.example/api';
    expect(resolveImportWorkerTargetBaseUrl()).toBe('https://core.example/api');
  });

  it('falls back to CLOUD_TASKS_TARGET_BASE_URL when notification is unset', () => {
    process.env.CLOUD_TASKS_TARGET_BASE_URL = 'https://local.example/api';
    expect(resolveImportWorkerTargetBaseUrl()).toBe('https://local.example/api');
  });
});

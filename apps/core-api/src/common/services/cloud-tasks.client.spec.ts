import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { Logger } from '@nestjs/common';
import { CloudTasksClient } from '@google-cloud/tasks';
import { initializeCloudTasksClient } from './cloud-tasks.client.js';

const SERVICE_ACCOUNT_KEY = JSON.stringify({
  client_email: 'worker@auto-core-platform.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
  project_id: 'auto-core-platform',
});

function createLogger() {
  return { log: jest.fn(), error: jest.fn() };
}

describe('initializeCloudTasksClient', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GCP_CREDENTIALS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('falls back to default credentials without logging when GCP_CREDENTIALS is unset', () => {
    const logger = createLogger();

    const result = initializeCloudTasksClient(logger as unknown as Logger);

    expect(result.client).toBeInstanceOf(CloudTasksClient);
    expect(result.cachedProjectId).toBeUndefined();
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('uses the inline service account and caches its project id', () => {
    process.env.GCP_CREDENTIALS = SERVICE_ACCOUNT_KEY;
    const logger = createLogger();

    const result = initializeCloudTasksClient(logger as unknown as Logger);

    expect(result.client).toBeInstanceOf(CloudTasksClient);
    expect(result.cachedProjectId).toBe('auto-core-platform');
    expect(logger.log).toHaveBeenCalledWith(
      'Cloud Tasks client initialized with GCP_CREDENTIALS from env',
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs and falls back to default credentials when GCP_CREDENTIALS is not JSON', () => {
    process.env.GCP_CREDENTIALS = 'not-json';
    const logger = createLogger();

    const result = initializeCloudTasksClient(logger as unknown as Logger);

    expect(result.client).toBeInstanceOf(CloudTasksClient);
    expect(result.cachedProjectId).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to parse GCP_CREDENTIALS for Cloud Tasks client',
      ),
      expect.any(String),
    );
  });

  it('logs and falls back when client_email or private_key is missing', () => {
    process.env.GCP_CREDENTIALS = JSON.stringify({
      project_id: 'auto-core-platform',
    });
    const logger = createLogger();

    const result = initializeCloudTasksClient(logger as unknown as Logger);

    expect(result.client).toBeInstanceOf(CloudTasksClient);
    expect(result.cachedProjectId).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'GCP_CREDENTIALS does not include client_email/private_key fields',
      ),
      expect.any(String),
    );
  });
});

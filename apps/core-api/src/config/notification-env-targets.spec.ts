import { notificationEnvIssues } from './notification-env.js';

const base = { NODE_ENV: 'development' };

describe('notification targets stay apart from the PDF targets (AUT-356)', () => {
  it('refuses a notification target equal to the PDF target, whatever the trailing slash', () => {
    expect(
      notificationEnvIssues({
        ...base,
        CLOUD_TASKS_TARGET_BASE_URL: 'https://worker.example/api',
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL: 'https://worker.example/api/',
      }),
    ).toEqual([
      { key: 'CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL', kind: 'invalid' },
    ]);
  });

  it('refuses a notification target on the PDF origin, whatever the path, case or default port', () => {
    expect(
      notificationEnvIssues({
        ...base,
        CLOUD_TASKS_TARGET_BASE_URL: 'https://worker.example/api',
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL:
          'https://Worker.example:443/other',
      }),
    ).toEqual([
      { key: 'CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL', kind: 'invalid' },
    ]);
  });

  it('refuses a notification target that is not a URL', () => {
    expect(
      notificationEnvIssues({
        ...base,
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL: 'core-api.example/api',
      }),
    ).toEqual([
      { key: 'CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL', kind: 'invalid' },
    ]);
  });

  it('accepts a notification target on another origin', () => {
    expect(
      notificationEnvIssues({
        ...base,
        CLOUD_TASKS_TARGET_BASE_URL: 'https://worker.example/api',
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL:
          'https://core-api.example/api',
      }),
    ).toEqual([]);
  });

  it('refuses a notification queue that is the PDF queue', () => {
    expect(
      notificationEnvIssues({
        ...base,
        CLOUD_TASKS_QUEUE: 'pdf-queue',
        CLOUD_TASKS_NOTIFICATION_QUEUE: 'pdf-queue',
      }),
    ).toEqual([{ key: 'CLOUD_TASKS_NOTIFICATION_QUEUE', kind: 'invalid' }]);
  });
});

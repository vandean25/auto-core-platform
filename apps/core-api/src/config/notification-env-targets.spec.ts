import { notificationEnvIssues } from './notification-env.js';

const base = { NODE_ENV: 'development' };

describe('notification targets stay apart from the PDF targets (AUT-356)', () => {
  it('refuses a notification target equal to the PDF target, whatever the trailing slash', () => {
    expect(
      notificationEnvIssues({
        ...base,
        NODE_ENV: 'production',
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
        NODE_ENV: 'production',
        CLOUD_TASKS_TARGET_BASE_URL: 'https://worker.example/api',
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL:
          'https://Worker.example:443/other',
      }),
    ).toEqual([
      { key: 'CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL', kind: 'invalid' },
    ]);
  });

  it('allows a shared origin in development, where one process serves both targets', () => {
    expect(
      notificationEnvIssues({
        ...base,
        CLOUD_TASKS_TARGET_BASE_URL: 'http://localhost:3000/api',
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL: 'http://localhost:3000/api',
      }),
    ).toEqual([]);
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

  it.each([
    'localhost:3000/api',
    'ftp://core-api.example/api',
    'file:///srv/api',
  ])(
    'refuses a notification target that is not an http(s) URL: %s',
    (target) => {
      expect(
        notificationEnvIssues({
          ...base,
          CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL: target,
        }),
      ).toEqual([
        { key: 'CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL', kind: 'invalid' },
      ]);
    },
  );

  it('requires the whole wake-up path for a live deploy in production', () => {
    expect(
      notificationEnvIssues({
        NODE_ENV: 'production',
        NOTIFICATION_EMAIL_MODE: 'live',
        NOTIFICATION_EMAIL_FROM_ADDRESS: 'kontakt@example.at',
      }),
    ).toEqual([
      { key: 'CLOUD_TASKS_NOTIFICATION_QUEUE', kind: 'required' },
      { key: 'CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL', kind: 'required' },
      { key: 'CLOUD_TASKS_LOCATION', kind: 'required' },
      { key: 'CLOUD_TASKS_INVOKER_SA', kind: 'required' },
      { key: 'CLOUD_TASKS_WORKER_SECRET', kind: 'required' },
    ]);
  });

  it('accepts a complete live deploy in production', () => {
    expect(
      notificationEnvIssues({
        NODE_ENV: 'production',
        CLOUD_TASKS_QUEUE: 'pdf-queue',
        CLOUD_TASKS_TARGET_BASE_URL: 'https://worker.example/api',
        CLOUD_TASKS_NOTIFICATION_QUEUE: 'notification-queue',
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL:
          'https://core-api.example/api',
        CLOUD_TASKS_LOCATION: 'europe-west3',
        CLOUD_TASKS_INVOKER_SA: 'invoker@example.iam.gserviceaccount.com',
        CLOUD_TASKS_WORKER_SECRET: 'worker-secret',
        NOTIFICATION_EMAIL_MODE: 'live',
        NOTIFICATION_EMAIL_FROM_ADDRESS: 'kontakt@example.at',
      }),
    ).toEqual([]);
  });

  it('refuses a live production deploy that has Cloud Tasks switched off', () => {
    expect(
      notificationEnvIssues({
        NODE_ENV: 'production',
        CLOUD_TASKS_QUEUE: 'pdf-queue',
        CLOUD_TASKS_TARGET_BASE_URL: 'https://worker.example/api',
        CLOUD_TASKS_NOTIFICATION_QUEUE: 'notification-queue',
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL:
          'https://core-api.example/api',
        CLOUD_TASKS_LOCATION: 'europe-west3',
        CLOUD_TASKS_INVOKER_SA: 'invoker@example.iam.gserviceaccount.com',
        CLOUD_TASKS_WORKER_SECRET: 'worker-secret',
        CLOUD_TASKS_ENABLED: 'false',
        NOTIFICATION_EMAIL_MODE: 'live',
        NOTIFICATION_EMAIL_FROM_ADDRESS: 'kontakt@example.at',
      }),
    ).toEqual([{ key: 'CLOUD_TASKS_ENABLED', kind: 'invalid' }]);
  });

  it('does not ask for the wake-up settings for a local fake run in development', () => {
    expect(
      notificationEnvIssues({
        ...base,
        NOTIFICATION_EMAIL_MODE: 'fake',
        NOTIFICATION_EMAIL_FROM_ADDRESS: 'kontakt@example.at',
      }),
    ).toEqual([]);
  });

  it('accepts an http notification target on another origin', () => {
    expect(
      notificationEnvIssues({
        ...base,
        CLOUD_TASKS_TARGET_BASE_URL: 'https://worker.example/api',
        CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL:
          'http://core-api.internal:8080/api',
      }),
    ).toEqual([]);
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

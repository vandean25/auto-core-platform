import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCloudBuildDeployContracts } from './check-cloudrun-env-contract.js';

/** Notification settings belong to core-api. The PDF worker renders and never enqueues (AUT-356). */
function notificationKeysIn(
  environment: ReadonlyMap<string, string>,
): string[] {
  return [...environment.keys()].filter(
    (key) =>
      key.startsWith('NOTIFICATION_') ||
      key.startsWith('CLOUD_TASKS_NOTIFICATION_'),
  );
}

describe('PDF worker must not enqueue notifications (AUT-356)', () => {
  it('keeps every notification setting out of the pdf-worker deploy environment', () => {
    const cloudBuild = readFileSync(
      join(import.meta.dirname, '../../../cloudbuild.yaml'),
      'utf8',
    );

    expect(
      notificationKeysIn(parseCloudBuildDeployContracts(cloudBuild).pdfWorker),
    ).toEqual([]);
  });

  it('flags a notification queue or sender flag on the pdf worker', () => {
    expect(
      notificationKeysIn(new Map([['CLOUD_TASKS_NOTIFICATION_QUEUE', 'q']])),
    ).toEqual(['CLOUD_TASKS_NOTIFICATION_QUEUE']);
    expect(
      notificationKeysIn(new Map([['NOTIFICATION_EMAIL_MODE', 'fake']])),
    ).toEqual(['NOTIFICATION_EMAIL_MODE']);
  });

  it('accepts pdf-worker keys that do not touch notifications', () => {
    expect(
      notificationKeysIn(new Map([['CLOUD_TASKS_WORKER_SECRET', 'x']])),
    ).toEqual([]);
  });
});

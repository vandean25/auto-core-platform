import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCloudBuildDeployContracts,
  REQUIRED_CORE_API_PRODUCTION_ENV_KEYS,
} from './check-cloudrun-env-contract';

const cloudBuildPath = join(__dirname, '../../../cloudbuild.yaml');

describe('Cloud Run environment contract', () => {
  it('includes every required production key on core-api', () => {
    const source = readFileSync(cloudBuildPath, 'utf8');
    const { coreApi } = parseCloudBuildDeployContracts(source);

    expect([...coreApi.keys()]).toEqual(
      expect.arrayContaining([...REQUIRED_CORE_API_PRODUCTION_ENV_KEYS]),
    );
    expect(coreApi.get('WORKSHOP_MEDIA_BUCKET')).toBe(
      'WORKSHOP_MEDIA_BUCKET:latest',
    );
  });

  it('keeps mechanic media and enqueue settings off the PDF worker', () => {
    const source = readFileSync(cloudBuildPath, 'utf8');
    const { pdfWorker } = parseCloudBuildDeployContracts(source);

    expect(pdfWorker.has('WORKSHOP_MEDIA_BUCKET')).toBe(false);
    expect(pdfWorker.has('CLOUD_TASKS_ENABLED')).toBe(false);
    expect(pdfWorker.has('CLOUD_TASKS_LOCATION')).toBe(false);
    expect(pdfWorker.has('CLOUD_TASKS_QUEUE')).toBe(false);
    expect(pdfWorker.has('CLOUD_TASKS_TARGET_BASE_URL')).toBe(false);
    expect(pdfWorker.has('CLOUD_TASKS_INVOKER_SA')).toBe(false);
  });
});

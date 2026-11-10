import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getIncorrectEnvironmentValues,
  parseCloudBuildDeployContracts,
  parseCloudBuildDeployStep,
  parseCloudBuildSubstitutions,
  resolveCloudBuildSubstitutionRefs,
  REQUIRED_CORE_API_PRODUCTION_ENV_KEYS,
  REQUIRED_CORE_API_PRODUCTION_ENV_VALUES,
  REQUIRED_PDF_WORKER_BOOT_ENV_KEYS,
} from './check-cloudrun-env-contract.js';

const QA_ESTIMATE_SEND_ENV = {
  CUSTOMER_ESTIMATE_SEND_ENABLED: 'true',
  ESTIMATE_APPROVAL_BASE_URL: 'https://auto-core-platform-vande.web.app',
} as const;

function resolvedCoreApiEnv(source: string) {
  const substitutions = parseCloudBuildSubstitutions(source);
  const coreApi = parseCloudBuildDeployStep(source, 'deploy-cloud-run');
  return resolveCloudBuildSubstitutionRefs(coreApi, substitutions);
}

const cloudBuildPath = join(import.meta.dirname, '../../../cloudbuild.yaml');
const cloudBuildStagingPath = join(
  import.meta.dirname,
  '../../../cloudbuild.staging.yaml',
);

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
    expect(coreApi.get('REDIS_URL')).toBe('REDIS_URL:latest');
    expect(coreApi.get('CATALOG_HIT_HMAC_SECRET')).toBe(
      'CATALOG_HIT_HMAC_SECRET:latest',
    );
    expect(coreApi.get('INVOICE_BRANDING_WRITER_ENABLED')).toBe('true');
  });

  it('includes boot-required secrets on the PDF worker', () => {
    const source = readFileSync(cloudBuildPath, 'utf8');
    const { pdfWorker } = parseCloudBuildDeployContracts(source);

    expect([...pdfWorker.keys()]).toEqual(
      expect.arrayContaining([...REQUIRED_PDF_WORKER_BOOT_ENV_KEYS]),
    );
    expect(pdfWorker.get('CATALOG_HIT_HMAC_SECRET')).toBe(
      'CATALOG_HIT_HMAC_SECRET:latest',
    );
  });

  it('keeps mechanic media and enqueue settings off the PDF worker', () => {
    const source = readFileSync(cloudBuildPath, 'utf8');
    const { pdfWorker } = parseCloudBuildDeployContracts(source);

    expect(pdfWorker.get('INVOICE_PDF_BUCKET')).toBe(
      'INVOICE_PDF_BUCKET:latest',
    );
    expect(pdfWorker.has('WORKSHOP_MEDIA_BUCKET')).toBe(false);
    expect(pdfWorker.has('REDIS_URL')).toBe(false);
    expect(pdfWorker.has('CLOUD_TASKS_ENABLED')).toBe(false);
    expect(pdfWorker.has('CLOUD_TASKS_LOCATION')).toBe(false);
    expect(pdfWorker.has('CLOUD_TASKS_QUEUE')).toBe(false);
    expect(pdfWorker.has('CLOUD_TASKS_TARGET_BASE_URL')).toBe(false);
    expect(pdfWorker.has('CLOUD_TASKS_INVOKER_SA')).toBe(false);
    expect(pdfWorker.has('INVOICE_BRANDING_WRITER_ENABLED')).toBe(false);
  });

  it('enables the branding writer on staging core-api only', () => {
    const source = readFileSync(cloudBuildStagingPath, 'utf8');
    const stagingCoreApi = parseCloudBuildDeployStep(
      source,
      'deploy-staging-cloud-run',
    );

    expect(stagingCoreApi.get('INVOICE_BRANDING_WRITER_ENABLED')).toBe('true');
  });

  it('requires INVOICE_BRANDING_WRITER_ENABLED=true on production core-api', () => {
    const source = readFileSync(cloudBuildPath, 'utf8');
    const { coreApi } = parseCloudBuildDeployContracts(source);

    expect(
      getIncorrectEnvironmentValues(
        coreApi,
        REQUIRED_CORE_API_PRODUCTION_ENV_VALUES,
      ),
    ).toEqual([]);
  });

  it('sets QA customer estimate-send flags on tag-triggered core-api deploy', () => {
    const source = readFileSync(cloudBuildPath, 'utf8');
    const coreApi = resolvedCoreApiEnv(source);

    expect(coreApi.get('CUSTOMER_ESTIMATE_SEND_ENABLED')).toBe(
      QA_ESTIMATE_SEND_ENV.CUSTOMER_ESTIMATE_SEND_ENABLED,
    );
    expect(coreApi.get('ESTIMATE_APPROVAL_BASE_URL')).toBe(
      QA_ESTIMATE_SEND_ENV.ESTIMATE_APPROVAL_BASE_URL,
    );
  });

  it('keeps customer estimate-send flags off staging core-api and the pdf worker', () => {
    const releaseBuild = readFileSync(cloudBuildPath, 'utf8');
    const stagingBuild = readFileSync(cloudBuildStagingPath, 'utf8');
    const { pdfWorker } = parseCloudBuildDeployContracts(releaseBuild);
    const stagingCoreApi = parseCloudBuildDeployStep(
      stagingBuild,
      'deploy-staging-cloud-run',
    );

    for (const key of Object.keys(QA_ESTIMATE_SEND_ENV)) {
      expect(pdfWorker.has(key)).toBe(false);
      expect(stagingCoreApi.has(key)).toBe(false);
    }
  });

  it('does not source customer estimate-send settings from Secret Manager', () => {
    const source = readFileSync(cloudBuildPath, 'utf8');
    const estimateKeys = Object.keys(QA_ESTIMATE_SEND_ENV);
    const availableSecrets = source.slice(
      source.indexOf('availableSecrets:'),
      source.indexOf('\nsteps:'),
    );
    const secretEnvKeys = [
      ...source.matchAll(/--set-secrets\s+"([^"]+)"/g),
    ].flatMap((match) =>
      match[1].split(',').map((entry) => entry.slice(0, entry.indexOf('='))),
    );

    for (const key of estimateKeys) {
      expect(availableSecrets).not.toMatch(new RegExp(`env:\\s*${key}\\b`));
      expect(secretEnvKeys).not.toContain(key);
    }
  });

  it('flags missing or disabled INVOICE_BRANDING_WRITER_ENABLED', () => {
    const missing = new Map<string, string>();
    expect(
      getIncorrectEnvironmentValues(
        missing,
        REQUIRED_CORE_API_PRODUCTION_ENV_VALUES,
      ),
    ).toEqual([
      'INVOICE_BRANDING_WRITER_ENABLED=(missing) (expected true)',
    ]);

    const disabled = new Map<string, string>([
      ['INVOICE_BRANDING_WRITER_ENABLED', 'false'],
    ]);
    expect(
      getIncorrectEnvironmentValues(
        disabled,
        REQUIRED_CORE_API_PRODUCTION_ENV_VALUES,
      ),
    ).toEqual(['INVOICE_BRANDING_WRITER_ENABLED=false (expected true)']);
  });
});

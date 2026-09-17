import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDirectRun } from './is-direct-run.mjs';

export const REQUIRED_CORE_API_PRODUCTION_ENV_KEYS = [
  'NODE_ENV',
  'FRONTEND_URL',
  'SENTRY_RELEASE',
  'FIREBASE_PROJECT_ID',
  'DATABASE_URL',
  'DATABASE_URL_POOLED',
  'SENTRY_DSN',
  'INVOICE_PDF_BUCKET',
  'WORKSHOP_MEDIA_BUCKET',
  'SECRET_ENCRYPTION_KEY',
  'CATALOG_HIT_HMAC_SECRET',
  'CLOUD_TASKS_ENABLED',
  'CLOUD_TASKS_LOCATION',
  'CLOUD_TASKS_QUEUE',
  'CLOUD_TASKS_TARGET_BASE_URL',
  'CLOUD_TASKS_INVOKER_SA',
  'CLOUD_TASKS_WORKER_SECRET',
  'REDIS_URL',
] as const;

export const REQUIRED_PDF_WORKER_BOOT_ENV_KEYS = [
  'DATABASE_URL',
  'SECRET_ENCRYPTION_KEY',
  'CATALOG_HIT_HMAC_SECRET',
] as const;

export type CloudRunDeployEnvironment = Map<string, string>;

export interface CloudBuildDeployContracts {
  readonly coreApi: CloudRunDeployEnvironment;
  readonly pdfWorker: CloudRunDeployEnvironment;
}

const DEPLOY_STEP_PATTERN = /^  - id: ([^\r\n]+)\r?$/gm;
const SET_ARGUMENT_PATTERN = /--set-(?:env-vars|secrets)\s+"([^"]+)"/g;

export function parseCloudBuildDeployContracts(
  cloudBuild: string,
): CloudBuildDeployContracts {
  return {
    coreApi: parseDeployEnvironment(
      extractBuildStep(cloudBuild, 'deploy-cloud-run'),
    ),
    pdfWorker: parseDeployEnvironment(
      extractBuildStep(cloudBuild, 'deploy-pdf-worker'),
    ),
  };
}

function extractBuildStep(cloudBuild: string, stepId: string): string {
  const steps = [...cloudBuild.matchAll(DEPLOY_STEP_PATTERN)];
  const step = steps.find((match) => match[1] === stepId);
  if (!step || step.index === undefined) {
    throw new Error(`Cloud Build step not found: ${stepId}`);
  }

  const contentStart = step.index + step[0].length;
  const followingStep = steps.find(
    (candidate) =>
      candidate.index !== undefined && candidate.index > step.index!,
  );
  const contentEnd = followingStep?.index ?? cloudBuild.length;
  return cloudBuild.slice(contentStart, contentEnd);
}

function parseDeployEnvironment(deployStep: string): CloudRunDeployEnvironment {
  const environment = new Map<string, string>();
  const setArguments = [...deployStep.matchAll(SET_ARGUMENT_PATTERN)];

  if (setArguments.length === 0) {
    throw new Error('Cloud Run deploy step has no environment arguments');
  }

  for (const setArgument of setArguments) {
    for (const entry of setArgument[1].split(',')) {
      const separatorIndex = entry.indexOf('=');
      if (separatorIndex <= 0) {
        throw new Error(`Invalid Cloud Run environment entry: ${entry}`);
      }
      const key = entry.slice(0, separatorIndex);
      const value = entry.slice(separatorIndex + 1);
      environment.set(key, value);
    }
  }

  return environment;
}

function missingEnvironmentKeys(
  environment: CloudRunDeployEnvironment,
  requiredKeys: readonly string[],
): readonly string[] {
  return requiredKeys.filter((key) => !environment.has(key));
}

function main(): void {
  const cloudBuildPath = join(import.meta.dirname, '../../../cloudbuild.yaml');
  const source = readFileSync(cloudBuildPath, 'utf8');
  const { coreApi, pdfWorker } = parseCloudBuildDeployContracts(source);
  const missingCoreApiKeys = missingEnvironmentKeys(
    coreApi,
    REQUIRED_CORE_API_PRODUCTION_ENV_KEYS,
  );
  const missingPdfWorkerKeys = missingEnvironmentKeys(
    pdfWorker,
    REQUIRED_PDF_WORKER_BOOT_ENV_KEYS,
  );

  if (missingCoreApiKeys.length > 0) {
    console.error(
      `Cloud Run core-api environment contract is missing ${missingCoreApiKeys.length} required key(s). See REQUIRED_CORE_API_PRODUCTION_ENV_KEYS in check-cloudrun-env-contract.ts.`,
    );
    process.exitCode = 1;
    return;
  }

  if (missingPdfWorkerKeys.length > 0) {
    console.error(
      `Cloud Run pdf-worker environment contract is missing ${missingPdfWorkerKeys.length} required key(s). See REQUIRED_PDF_WORKER_BOOT_ENV_KEYS in check-cloudrun-env-contract.ts.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('Cloud Run environment contract passed.');
}

if (
  isDirectRun({
    moduleUrl: import.meta.url,
    moduleFilename: import.meta.filename,
    argv1: process.argv[1],
  })
) {
  main();
}

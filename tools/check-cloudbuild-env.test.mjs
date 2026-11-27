import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  checkCloudBuildEnv,
  extractBootRequiredEnvKeys,
  parseCloudBuildDeploySteps,
} from './check-cloudbuild-env-lib.mjs';

const cliPath = path.join(import.meta.dirname, 'check-cloudbuild-env.mjs');

const FIXTURE_ENV_TS = `
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string(),
  DATABASE_URL: z.string().optional(),
  SECRET_ENCRYPTION_KEY: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  CLOUD_TASKS_ENABLED: z.string().optional(),
  CLOUD_TASKS_WORKER_SECRET: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'test') {
    return;
  }
  addRequiredIssue(ctx, 'DATABASE_URL', env.DATABASE_URL);
  addEncryptionKeyIssues(ctx, env.SECRET_ENCRYPTION_KEY);
  if (env.NODE_ENV === 'production') {
    addRequiredIssue(ctx, 'FRONTEND_URL', env.FRONTEND_URL);
  }
  if (arePdfWorkersEnabled(env)) {
    addRequiredIssue(ctx, 'CLOUD_TASKS_WORKER_SECRET', env.CLOUD_TASKS_WORKER_SECRET);
  }
});

function addEncryptionKeyIssues(ctx, rawKey) {
  if (!rawKey) {
    addRequiredIssue(ctx, 'SECRET_ENCRYPTION_KEY', rawKey);
  }
}
`;

const QA_CLOUDBUILD_ALL_MOUNTED = `
steps:
  - id: deploy-pdf-worker
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api-pdf-worker" \\
          --set-env-vars "NODE_ENV=production,FRONTEND_URL=https://qa.example.invalid" \\
          --set-secrets "DATABASE_URL=DB_DUMMY:latest,SECRET_ENCRYPTION_KEY=ENC_DUMMY:latest,CLOUD_TASKS_WORKER_SECRET=WORKER_DUMMY:latest"

  - id: deploy-cloud-run
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api" \\
          --set-env-vars "NODE_ENV=production,FRONTEND_URL=https://qa.example.invalid,CLOUD_TASKS_ENABLED=true" \\
          --set-secrets "DATABASE_URL=DB_DUMMY:latest,SECRET_ENCRYPTION_KEY=ENC_DUMMY:latest,CLOUD_TASKS_WORKER_SECRET=WORKER_DUMMY:latest"
`;

const PROD_CLOUDBUILD_ALL_MOUNTED = `
steps:
  - id: deploy-staging-cloud-run
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api-staging" \\
          --set-env-vars "NODE_ENV=production,FRONTEND_URL=https://example.invalid" \\
          --set-secrets "DATABASE_URL=DB_PROD_DUMMY:latest,SECRET_ENCRYPTION_KEY=ENC_PROD_DUMMY:latest"
`;

test('extractBootRequiredEnvKeys extracts unconditional, encryption, production-only, and pdf-worker keys', () => {
  const keys = extractBootRequiredEnvKeys(FIXTURE_ENV_TS);
  assert.deepEqual(keys, [
    { key: 'DATABASE_URL', scope: 'always' },
    { key: 'SECRET_ENCRYPTION_KEY', scope: 'always' },
    { key: 'FRONTEND_URL', scope: 'production' },
    { key: 'CLOUD_TASKS_WORKER_SECRET', scope: 'pdf-worker' },
  ]);
});

test('parseCloudBuildDeploySteps extracts only key names and never secret values', () => {
  const steps = parseCloudBuildDeploySteps(`
steps:
  - id: deploy-cloud-run
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api" \\
          --set-env-vars "NODE_ENV=production" \\
          --set-secrets "DATABASE_URL=SUPER_SECRET_REF_DO_NOT_EXPOSE:latest"
`);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].stepId, 'deploy-cloud-run');
  assert.equal(steps[0].role, 'core-api');
  assert.equal(steps[0].keys.has('DATABASE_URL'), true);
  assert.equal(steps[0].keys.has('NODE_ENV'), true);
  assert.equal(JSON.stringify([...steps[0].keys]).includes('SUPER_SECRET_REF_DO_NOT_EXPOSE'), false);
});

test('WHEN all required keys are mounted, THEN the check passes', () => {
  const result = checkCloudBuildEnv({
    envTsSource: FIXTURE_ENV_TS,
    targets: [
      { file: 'cloudbuild.yaml', content: QA_CLOUDBUILD_ALL_MOUNTED },
      { file: 'cloudbuild.staging.yaml', content: PROD_CLOUDBUILD_ALL_MOUNTED },
    ],
    allowlist: [],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('WHEN a production-only key is missing in the QA file, THEN the check passes', () => {
  const qaNonProd = `
steps:
  - id: deploy-cloud-run
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api" \\
          --set-env-vars "NODE_ENV=development" \\
          --set-secrets "DATABASE_URL=DB_DUMMY:latest,SECRET_ENCRYPTION_KEY=ENC_DUMMY:latest"
`;
  const result = checkCloudBuildEnv({
    envTsSource: FIXTURE_ENV_TS,
    targets: [
      { file: 'cloudbuild.yaml', content: qaNonProd },
    ],
    allowlist: [],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('WHEN a required key is missing in a Cloud Build file, THEN the check fails and names the key and the file', () => {
  const missingSecretQa = QA_CLOUDBUILD_ALL_MOUNTED.replace(
    'SECRET_ENCRYPTION_KEY=ENC_DUMMY:latest,',
    '',
  );
  const result = checkCloudBuildEnv({
    envTsSource: FIXTURE_ENV_TS,
    targets: [
      { file: 'cloudbuild.yaml', content: missingSecretQa, isProduction: false },
      { file: 'cloudbuild.staging.yaml', content: PROD_CLOUDBUILD_ALL_MOUNTED, isProduction: true },
    ],
    allowlist: [],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((e) => e.includes('SECRET_ENCRYPTION_KEY') && e.includes('cloudbuild.yaml')), true);
});

test('WHEN a when-enabled flag is set via substitutions to true and its required key is absent, THEN the check fails naming the key and file', () => {
  const envWithConditional = `
import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.string(),
  CUSTOMER_ESTIMATE_SEND_ENABLED: z.string().optional(),
  ESTIMATE_APPROVAL_BASE_URL: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.CUSTOMER_ESTIMATE_SEND_ENABLED) {
    addRequiredIssue(ctx, 'ESTIMATE_APPROVAL_BASE_URL', env.ESTIMATE_APPROVAL_BASE_URL);
  }
});
`;
  const qaWithSubEnabledMissingUrl = `
substitutions:
  _CUSTOMER_ESTIMATE_SEND_ENABLED: "true"
steps:
  - id: deploy-cloud-run
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api" \\
          --set-env-vars "NODE_ENV=production,CUSTOMER_ESTIMATE_SEND_ENABLED=\${_CUSTOMER_ESTIMATE_SEND_ENABLED}"
`;
  const result = checkCloudBuildEnv({
    envTsSource: envWithConditional,
    targets: [
      { file: 'cloudbuild.yaml', content: qaWithSubEnabledMissingUrl, isProduction: false },
    ],
    allowlist: [],
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some(
      (e) => e.includes('ESTIMATE_APPROVAL_BASE_URL') && e.includes('cloudbuild.yaml'),
    ),
    true,
  );
});

test('WHEN a key is on the allowlist and missing, THEN the check passes with a warning naming the ticket', () => {
  const missingInProd = PROD_CLOUDBUILD_ALL_MOUNTED.replace(
    ',SECRET_ENCRYPTION_KEY=ENC_PROD_DUMMY:latest',
    '',
  );
  const result = checkCloudBuildEnv({
    envTsSource: FIXTURE_ENV_TS,
    targets: [
      { file: 'cloudbuild.yaml', content: QA_CLOUDBUILD_ALL_MOUNTED, isProduction: false },
      { file: 'cloudbuild.staging.yaml', content: missingInProd, isProduction: true },
    ],
    allowlist: [
      { file: 'cloudbuild.staging.yaml', key: 'SECRET_ENCRYPTION_KEY', ticket: 'AUT-9999' },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(
    result.warnings.some(
      (w) => w.includes('SECRET_ENCRYPTION_KEY') && w.includes('cloudbuild.staging.yaml') && w.includes('AUT-9999'),
    ),
    true,
  );
});

test('WHEN an allowlisted key is now mounted, THEN the check fails asking to remove the allowlist entry', () => {
  const result = checkCloudBuildEnv({
    envTsSource: FIXTURE_ENV_TS,
    targets: [
      { file: 'cloudbuild.yaml', content: QA_CLOUDBUILD_ALL_MOUNTED, isProduction: false },
      { file: 'cloudbuild.staging.yaml', content: PROD_CLOUDBUILD_ALL_MOUNTED, isProduction: true },
    ],
    allowlist: [
      { file: 'cloudbuild.staging.yaml', key: 'SECRET_ENCRYPTION_KEY', ticket: 'AUT-9999' },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.errors.some(
      (e) =>
        e.includes('SECRET_ENCRYPTION_KEY') &&
        e.includes('cloudbuild.staging.yaml') &&
        /remove/i.test(e),
    ),
    true,
  );
});

test('CLI never prints secret values from --set-secrets even on failure', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cloudbuild-env-test-'));
  try {
    const envPath = path.join(dir, 'env.ts');
    const qaPath = path.join(dir, 'cloudbuild.yaml');
    const prodPath = path.join(dir, 'cloudbuild.staging.yaml');
    writeFileSync(envPath, FIXTURE_ENV_TS);
    writeFileSync(
      qaPath,
      QA_CLOUDBUILD_ALL_MOUNTED.replace('DB_DUMMY', 'TOP_SECRET_VALUE_XYZ').replace(
        'SECRET_ENCRYPTION_KEY=ENC_DUMMY:latest,',
        '',
      ),
    );
    writeFileSync(prodPath, PROD_CLOUDBUILD_ALL_MOUNTED);

    const res = spawnSync(
      process.execPath,
      [cliPath, '--env', envPath, '--qa', qaPath, '--prod', prodPath, '--no-default-allowlist'],
      { encoding: 'utf8' },
    );
    assert.notEqual(res.status, 0);
    const output = `${res.stdout}${res.stderr}`;
    assert.match(output, /SECRET_ENCRYPTION_KEY/);
    assert.equal(output.includes('TOP_SECRET_VALUE_XYZ'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WHEN a QA step sets NODE_ENV=production and omits FRONTEND_URL or FIREBASE_PROJECT_ID, THEN the check fails; GOOGLE_CLOUD_PROJECT satisfies FIREBASE_PROJECT_ID', () => {
  const envWithFirebase = `
import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.string(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production') {
    addRequiredIssue(ctx, 'FIREBASE_PROJECT_ID', env.FIREBASE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT);
    addRequiredIssue(ctx, 'FRONTEND_URL', env.FRONTEND_URL);
  }
});
`;
  const missingBoth = `
steps:
  - id: deploy-cloud-run
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api" \\
          --set-env-vars "NODE_ENV=production"
`;
  const failRes = checkCloudBuildEnv({
    envTsSource: envWithFirebase,
    targets: [{ file: 'cloudbuild.yaml', content: missingBoth }],
    allowlist: [],
  });
  assert.equal(failRes.ok, false);
  assert.equal(failRes.errors.some((e) => e.includes('FIREBASE_PROJECT_ID') && e.includes('cloudbuild.yaml')), true);
  assert.equal(failRes.errors.some((e) => e.includes('FRONTEND_URL') && e.includes('cloudbuild.yaml')), true);

  const withGoogleCloudProject = `
steps:
  - id: deploy-cloud-run
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api" \\
          --set-env-vars "NODE_ENV=production,GOOGLE_CLOUD_PROJECT=dummy-proj,FRONTEND_URL=https://qa.example.invalid"
`;
  const passRes = checkCloudBuildEnv({
    envTsSource: envWithFirebase,
    targets: [{ file: 'cloudbuild.yaml', content: withGoogleCloudProject }],
    allowlist: [],
  });
  assert.equal(passRes.ok, true);
});

test('WHEN SCHEDULER_MODE resolves to http and cron OIDC keys are missing, THEN the check fails; SCHEDULER_MODE=off skips them', () => {
  const envWithScheduler = `
import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.string(),
}).superRefine((env, ctx) => {
  addSchedulerEnvValidationIssues(ctx, env);
});
`;
  const qaHttpMissing = `
substitutions:
  _SCHEDULER_MODE: http
steps:
  - id: deploy-pdf-worker
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api-pdf-worker" \\
          --set-env-vars "NODE_ENV=production,SCHEDULER_MODE=off"
  - id: deploy-cloud-run
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api" \\
          --set-env-vars "NODE_ENV=production,SCHEDULER_MODE=\${_SCHEDULER_MODE}"
`;
  const failRes = checkCloudBuildEnv({
    envTsSource: envWithScheduler,
    targets: [{ file: 'cloudbuild.yaml', content: qaHttpMissing }],
    allowlist: [],
  });
  assert.equal(failRes.ok, false);
  assert.equal(failRes.errors.some((e) => e.includes('CRON_OIDC_AUDIENCE') && e.includes('deploy-cloud-run')), true);
  assert.equal(failRes.errors.some((e) => e.includes('CRON_INVOKER_SA_EMAIL') && e.includes('deploy-cloud-run')), true);
  assert.equal(failRes.errors.some((e) => e.includes('deploy-pdf-worker')), false);
});

test('WHEN NOTIFICATION_EMAIL_MODE=live in production and notification keys are missing, THEN the check fails', () => {
  const envWithNotif = `
import { z } from 'zod';
const envSchema = z.object({
  NODE_ENV: z.string(),
}).superRefine((env, ctx) => {
  for (const issue of notificationEnvIssues(env)) {
    if (issue.kind === 'required') {
      addRequiredIssue(ctx, issue.key, undefined);
    }
  }
});
`;
  const qaLiveMissing = `
substitutions:
  _NOTIFICATION_EMAIL_MODE: "live"
steps:
  - id: deploy-pdf-worker
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api-pdf-worker" \\
          --set-env-vars "NODE_ENV=production"
  - id: deploy-cloud-run
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api" \\
          --set-env-vars "NODE_ENV=production,NOTIFICATION_EMAIL_MODE=\${_NOTIFICATION_EMAIL_MODE}"
`;
  const failRes = checkCloudBuildEnv({
    envTsSource: envWithNotif,
    targets: [{ file: 'cloudbuild.yaml', content: qaLiveMissing }],
    allowlist: [],
  });
  assert.equal(failRes.ok, false);
  for (const key of [
    'NOTIFICATION_EMAIL_FROM_ADDRESS',
    'CLOUD_TASKS_NOTIFICATION_QUEUE',
    'CLOUD_TASKS_NOTIFICATION_TARGET_BASE_URL',
    'CLOUD_TASKS_LOCATION',
    'CLOUD_TASKS_INVOKER_SA',
    'CLOUD_TASKS_WORKER_SECRET',
  ]) {
    assert.equal(
      failRes.errors.some((e) => e.includes(key) && e.includes('deploy-cloud-run')),
      true,
      `Expected error for ${key}`,
    );
  }
  assert.equal(failRes.errors.some((e) => e.includes('deploy-pdf-worker')), false);
});

test('WHEN pdf-worker step does not enable Cloud Tasks, THEN CLOUD_TASKS_WORKER_SECRET is not required', () => {
  const qaNoCloudTasks = `
steps:
  - id: deploy-pdf-worker
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api-pdf-worker" \\
          --set-env-vars "NODE_ENV=production,FRONTEND_URL=https://qa.example.invalid" \\
          --set-secrets "DATABASE_URL=DB_DUMMY:latest,SECRET_ENCRYPTION_KEY=ENC_DUMMY:latest"
  - id: deploy-cloud-run
    name: gcr.io/cloud-builders/gcloud
    args:
      - -lc
      - |
        gcloud run deploy "core-api" \\
          --set-env-vars "NODE_ENV=production,FRONTEND_URL=https://qa.example.invalid" \\
          --set-secrets "DATABASE_URL=DB_DUMMY:latest,SECRET_ENCRYPTION_KEY=ENC_DUMMY:latest"
`;
  const res = checkCloudBuildEnv({
    envTsSource: FIXTURE_ENV_TS,
    targets: [{ file: 'cloudbuild.yaml', content: qaNoCloudTasks }],
    allowlist: [],
  });
  assert.equal(res.ok, true);
});


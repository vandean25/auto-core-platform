import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CORE_API_STARTUP_PROBE,
  extractBuildStep,
  formatCoreApiStartupProbeGcloud,
} from './check-cloudrun-env-contract.js';

const repoRoot = join(import.meta.dirname, '../../..');
const cloudBuildPath = join(repoRoot, 'cloudbuild.yaml');
const cloudBuildStagingPath = join(repoRoot, 'cloudbuild.staging.yaml');
const terraformMainPath = join(repoRoot, 'infra/main.tf');

describe('core-api Cloud Run startup probe', () => {
  const expectedGcloud = formatCoreApiStartupProbeGcloud();

  it('pins generous startup probe settings on production core-api deploy', () => {
    const coreApiDeploy = extractBuildStep(
      readFileSync(cloudBuildPath, 'utf8'),
      'deploy-cloud-run',
    );

    expect(coreApiDeploy).toMatch(
      new RegExp(
        `--startup-probe "${expectedGcloud.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
      ),
    );
  });

  it('pins the same startup probe on staging core-api deploy', () => {
    const stagingDeploy = extractBuildStep(
      readFileSync(cloudBuildStagingPath, 'utf8'),
      'deploy-staging-cloud-run',
    );

    expect(stagingDeploy).toMatch(
      new RegExp(
        `--startup-probe "${expectedGcloud.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
      ),
    );
  });

  it('matches Terraform startup_probe on core_api', () => {
    const terraform = readFileSync(terraformMainPath, 'utf8');
    const probe = CORE_API_STARTUP_PROBE;

    expect(terraform).toContain(`path = "${probe.httpGetPath}"`);
    expect(terraform).toContain(`port = ${probe.httpGetPort}`);
    expect(terraform).toContain(
      `initial_delay_seconds = ${probe.initialDelaySeconds}`,
    );
    expect(terraform).toContain(`timeout_seconds       = ${probe.timeoutSeconds}`);
    expect(terraform).toContain(`period_seconds        = ${probe.periodSeconds}`);
    expect(terraform).toContain(
      `failure_threshold     = ${probe.failureThreshold}`,
    );
  });
});

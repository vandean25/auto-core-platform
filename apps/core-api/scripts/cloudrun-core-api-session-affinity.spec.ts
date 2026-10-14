import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractBuildStep } from './check-cloudrun-env-contract.js';

const cloudBuildPath = join(import.meta.dirname, '../../../cloudbuild.yaml');

describe('core-api Cloud Run session affinity', () => {
  it('pins long-polling sessions to one replica on the core-api deploy step', () => {
    const coreApiDeploy = extractBuildStep(
      readFileSync(cloudBuildPath, 'utf8'),
      'deploy-cloud-run',
    );

    expect(coreApiDeploy).toMatch(/^\s+--session-affinity \\$/m);
  });
});

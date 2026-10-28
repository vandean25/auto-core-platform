import { ImportEntityType, ImportJobStatus } from '@prisma/client';
import { serializeImportJob } from '../import/import-job.serializer.js';

describe('MCP import job status', () => {
  it('tells the caller to POST apply when the job is stalled', () => {
    const job = serializeImportJob(
      {
        id: 'job-1',
        entity_type: ImportEntityType.VEHICLE_PARTY,
        source_system: 'legacy',
        file_name: 'parties.csv',
        file_sha256: 'abc',
        status: ImportJobStatus.APPLYING,
        mapping_json: {},
        options_json: {},
        totals_json: {},
        created_by: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        appliedAt: null,
      },
      { rows: 2, create: 1, update: 0, skip: 0, error: 0 },
    );
    expect(job.stalled).toBe(true);
    expect(job.recovery_hint).toBe(
      'Job is stalled. Re-apply it (POST apply) to resume.',
    );
  });
});

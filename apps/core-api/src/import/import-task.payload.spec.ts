import { signImportTaskPayload, verifyImportTaskPayload } from './import-task.payload.js';

describe('import task payload', () => {
  it('round-trips a signed worker payload', () => {
    const signed = signImportTaskPayload(
      { tenantId: 'tenant-1', jobId: 'job-1', phase: 'dry_run' },
      'test-secret',
    );
    expect(verifyImportTaskPayload(signed, 'test-secret')).toEqual({
      tenantId: 'tenant-1',
      jobId: 'job-1',
      phase: 'dry_run',
    });
  });

  it('rejects a tampered signature', () => {
    const signed = signImportTaskPayload(
      { tenantId: 'tenant-1', jobId: 'job-1', phase: 'apply' },
      'test-secret',
    );
    expect(() =>
      verifyImportTaskPayload({ ...signed, jobId: 'job-2' }, 'test-secret'),
    ).toThrow();
  });
});

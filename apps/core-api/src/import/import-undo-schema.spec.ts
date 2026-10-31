import { ImportJobStatus, Prisma } from '@prisma/client';

describe('Import Undo Schema (AUT-813)', () => {
  it('has UNDONE and PARTIALLY_UNDONE in ImportJobStatus enum', () => {
    expect(ImportJobStatus.UNDONE).toBe('UNDONE');
    expect(ImportJobStatus.PARTIALLY_UNDONE).toBe('PARTIALLY_UNDONE');
  });

  it('accepts before_snapshot_json on ImportJobRow input types', () => {
    const rowInput: Prisma.ImportJobRowCreateManyInput = {
      tenant_id: 'tenant-1',
      import_job_id: 'job-1',
      row_no: 1,
      action: 'UPDATE',
      before_snapshot_json: { test: 'value' },
    };
    expect(rowInput.before_snapshot_json).toEqual({ test: 'value' });
  });
});

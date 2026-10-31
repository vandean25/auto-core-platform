import { ImportJobStatus, Prisma } from '@prisma/client';

describe('Import Undo Schema (AUT-813)', () => {
  it('has UNDONE, PARTIALLY_UNDONE, and UNDOING in ImportJobStatus enum', () => {
    expect(ImportJobStatus.UNDONE).toBe('UNDONE');
    expect(ImportJobStatus.PARTIALLY_UNDONE).toBe('PARTIALLY_UNDONE');
    expect(ImportJobStatus.UNDOING).toBe('UNDOING');
  });

  it('accepts before_snapshot_json and undone_at on ImportJobRow input types', () => {
    const rowInput: Prisma.ImportJobRowCreateManyInput = {
      tenant_id: 'tenant-1',
      import_job_id: 'job-1',
      row_no: 1,
      action: 'UPDATE',
      before_snapshot_json: { test: 'value' },
      undone_at: new Date('2026-10-31T20:00:00.000Z'),
    };
    expect(rowInput.before_snapshot_json).toEqual({ test: 'value' });
    expect(rowInput.undone_at).toEqual(new Date('2026-10-31T20:00:00.000Z'));
  });
});

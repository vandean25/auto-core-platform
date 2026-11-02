import { ImportRowAction } from '@prisma/client';
import { planUndoRows } from './import-undo-plan.js';
import { UNDO_BLOCKED_REASONS } from './import-undo.types.js';
import { createMockClient } from './import-undo.guard.spec.support.js';

describe('planUndoRows', () => {
  const tenantId = 'tenant-1';
  const appliedAt = new Date('2026-10-30T10:00:00.000Z');

  it.each([
    {
      entity_id: null,
      reason: UNDO_BLOCKED_REASONS.LEGACY_JOB_NO_ENTITY_LINK,
    },
    {
      entity_id: 'cust-missing',
      reason: UNDO_BLOCKED_REASONS.ENTITY_NOT_FOUND,
    },
  ])(
    'blocks a row with entity_id $entity_id as $reason instead of UNKNOWN',
    async ({ entity_id, reason }) => {
      const rows = [
        {
          tenant_id: tenantId,
          import_job_id: 'job-1',
          row_no: 1,
          external_id: 'EXT-1',
          action: ImportRowAction.CREATE,
          entity_id,
          errors_json: null,
          warnings_json: null,
          normalized_json: { first_name: 'Planned' },
          apply_seq: 1,
          before_snapshot_json: null,
          undone_at: null,
        },
      ];

      const plan = await planUndoRows(
        createMockClient(),
        {
          tenantId,
          entityType: 'CUSTOMER',
          appliedAt,
          confirmedEntityIds: new Set(),
        },
        rows,
      );

      expect(plan).toHaveLength(1);
      expect(plan[0].action).toBeNull();
      expect(plan[0].reason).toBe(reason);
    },
  );
});

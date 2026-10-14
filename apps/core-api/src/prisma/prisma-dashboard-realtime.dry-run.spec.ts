import { DryRunChangeCollector } from '../dry-run/dry-run-change-collector.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import {
  recordDryRunChange,
  recordDryRunCreates,
} from './prisma-dashboard-realtime.dry-run.js';

describe('prisma-dashboard-realtime dry-run recording', () => {
  describe('recordDryRunChange', () => {
    it.each([
      ['CREATED', 'create'],
      ['UPDATED', 'update'],
      ['DELETED', 'delete'],
    ] as const)('records a %s action as a %s change', (action, op) => {
      const collector = new DryRunChangeCollector();

      DryRunStorage.run({ isDryRun: true, collector }, () => {
        recordDryRunChange('Customer', { id: 'cust-1' }, action);
      });

      expect(collector.getChanges()).toEqual([
        expect.objectContaining({ entity: 'Customer', id: 'cust-1', op }),
      ]);
    });

    it('records nothing when no collector is active', () => {
      expect(() =>
        recordDryRunChange('Customer', { id: 'cust-1' }, 'UPDATED'),
      ).not.toThrow();
    });

    it('records nothing without an entity id', () => {
      const collector = new DryRunChangeCollector();

      DryRunStorage.run({ isDryRun: true, collector }, () => {
        recordDryRunChange('Customer', { name: 'no id' }, 'UPDATED');
      });

      expect(collector.getChanges()).toEqual([]);
    });

    it('records nothing when there is no action to report', () => {
      const collector = new DryRunChangeCollector();

      DryRunStorage.run({ isDryRun: true, collector }, () => {
        recordDryRunChange('Customer', { id: 'cust-1' }, null);
      });

      expect(collector.getChanges()).toEqual([]);
    });
  });

  describe('recordDryRunCreates', () => {
    it('records every record with an id as a create', () => {
      const collector = new DryRunChangeCollector();

      DryRunStorage.run({ isDryRun: true, collector }, () => {
        recordDryRunCreates('Customer', [
          { id: 'cust-1' },
          { name: 'no id' },
          { id: 'cust-2' },
        ]);
      });

      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-1', op: 'create', provisional: true },
        { entity: 'Customer', id: 'cust-2', op: 'create', provisional: true },
      ]);
    });

    it('treats a single object as one record', () => {
      const collector = new DryRunChangeCollector();

      DryRunStorage.run({ isDryRun: true, collector }, () => {
        recordDryRunCreates('Customer', { id: 'cust-9' });
      });

      expect(collector.getChanges()).toEqual([
        { entity: 'Customer', id: 'cust-9', op: 'create', provisional: true },
      ]);
    });

    it.each([undefined, null])('records nothing for data %s', (data) => {
      const collector = new DryRunChangeCollector();

      DryRunStorage.run({ isDryRun: true, collector }, () => {
        recordDryRunCreates('Customer', data);
      });

      expect(collector.getChanges()).toEqual([]);
    });

    it('records nothing when no collector is active', () => {
      expect(() =>
        recordDryRunCreates('Customer', [{ id: 'cust-1' }]),
      ).not.toThrow();
    });
  });
});

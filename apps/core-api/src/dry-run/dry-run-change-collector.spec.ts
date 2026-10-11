import { DryRunChangeCollector } from './dry-run-change-collector.js';
import type { WouldChangeRecord } from './dry-run.types.js';

describe('DryRunChangeCollector', () => {
  let collector: DryRunChangeCollector;

  beforeEach(() => {
    collector = new DryRunChangeCollector();
  });

  it('starts with an empty change list', () => {
    expect(collector.getChanges()).toEqual([]);
  });

  it('records single change item', () => {
    const item: WouldChangeRecord = {
      entity: 'Customer',
      id: 'cust-123',
      op: 'create',
    };
    collector.recordChange(item);

    expect(collector.getChanges()).toEqual([{ ...item, provisional: true }]);
  });

  it('preserves insertion order across different operations and entities', () => {
    const items: WouldChangeRecord[] = [
      { entity: 'Customer', id: 'cust-1', op: 'create' },
      { entity: 'Vehicle', id: 'veh-1', op: 'create' },
      { entity: 'Customer', id: 'cust-1', op: 'update' },
      { entity: 'WorkshopOrder', id: 'wo-1', op: 'create' },
      { entity: 'Vehicle', id: 'veh-1', op: 'delete' },
    ];

    for (const item of items) {
      collector.recordChange(item);
    }

    expect(collector.getChanges()).toEqual([
      { entity: 'Customer', id: 'cust-1', op: 'create', provisional: true },
      { entity: 'Vehicle', id: 'veh-1', op: 'create', provisional: true },
      { entity: 'Customer', id: 'cust-1', op: 'update', provisional: true },
      { entity: 'WorkshopOrder', id: 'wo-1', op: 'create', provisional: true },
      { entity: 'Vehicle', id: 'veh-1', op: 'delete', provisional: true },
    ]);
  });

  it('deduplicates changes by entity:id:op key while keeping first occurrence position', () => {
    collector.recordChange({ entity: 'Customer', id: 'cust-1', op: 'create' });
    collector.recordChange({ entity: 'Vehicle', id: 'veh-1', op: 'create' });
    // Duplicate of first item
    collector.recordChange({ entity: 'Customer', id: 'cust-1', op: 'create' });
    // Another distinct item
    collector.recordChange({ entity: 'Customer', id: 'cust-1', op: 'update' });
    // Duplicate of second item
    collector.recordChange({ entity: 'Vehicle', id: 'veh-1', op: 'create' });

    expect(collector.getChanges()).toEqual([
      { entity: 'Customer', id: 'cust-1', op: 'create', provisional: true },
      { entity: 'Vehicle', id: 'veh-1', op: 'create', provisional: true },
      { entity: 'Customer', id: 'cust-1', op: 'update', provisional: true },
    ]);
  });

  it('returns a defensive copy of changes array', () => {
    collector.recordChange({ entity: 'Customer', id: 'cust-1', op: 'create' });
    const changes = collector.getChanges();
    changes.push({ entity: 'Fake', id: 'fake-1', op: 'delete', provisional: false });

    expect(collector.getChanges()).toHaveLength(1);
    expect(collector.getChanges()[0]).toEqual({
      entity: 'Customer',
      id: 'cust-1',
      op: 'create',
      provisional: true,
    });
  });

  it('clears recorded changes when clear() is called', () => {
    collector.recordChange({ entity: 'Customer', id: 'cust-1', op: 'create' });
    expect(collector.getChanges()).toHaveLength(1);

    collector.clear();
    expect(collector.getChanges()).toEqual([]);
  });

  describe('provisional ids', () => {
    it('marks a created row provisional, because the preview rolls the row back', () => {
      collector.recordChange({
        entity: 'WorkshopOrder',
        id: 'wo-preview',
        op: 'create',
      });

      expect(collector.getChanges()).toEqual([
        {
          entity: 'WorkshopOrder',
          id: 'wo-preview',
          op: 'create',
          provisional: true,
        },
      ]);
    });

    it('keeps the committed id of a change to a row that existed before the preview', () => {
      collector.recordChange({
        entity: 'FinanceSettings',
        id: 'fin-1',
        op: 'update',
      });

      expect(collector.getChanges()).toEqual([
        {
          entity: 'FinanceSettings',
          id: 'fin-1',
          op: 'update',
          provisional: false,
        },
      ]);
    });

    it('marks a delete of a row the same preview created provisional', () => {
      collector.recordChange({ entity: 'Vehicle', id: 'veh-1', op: 'create' });
      collector.recordChange({ entity: 'Vehicle', id: 'veh-1', op: 'delete' });

      expect(collector.getChanges()[1]).toEqual({
        entity: 'Vehicle',
        id: 'veh-1',
        op: 'delete',
        provisional: true,
      });
    });

    it('forgets the rows it created when clear() is called', () => {
      collector.recordChange({ entity: 'Vehicle', id: 'veh-1', op: 'create' });
      collector.clear();
      collector.recordChange({ entity: 'Vehicle', id: 'veh-1', op: 'update' });

      expect(collector.getChanges()).toEqual([
        { entity: 'Vehicle', id: 'veh-1', op: 'update', provisional: false },
      ]);
    });
  });
});

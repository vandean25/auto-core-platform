import { DryRunChangeCollector } from './dry-run-change-collector.js';
import type { WouldChangeItem } from './dry-run.types.js';

describe('DryRunChangeCollector', () => {
  let collector: DryRunChangeCollector;

  beforeEach(() => {
    collector = new DryRunChangeCollector();
  });

  it('starts with an empty change list', () => {
    expect(collector.getChanges()).toEqual([]);
  });

  it('records single change item', () => {
    const item: WouldChangeItem = {
      entity: 'Customer',
      id: 'cust-123',
      op: 'create',
    };
    collector.recordChange(item);

    expect(collector.getChanges()).toEqual([item]);
  });

  it('preserves insertion order across different operations and entities', () => {
    const items: WouldChangeItem[] = [
      { entity: 'Customer', id: 'cust-1', op: 'create' },
      { entity: 'Vehicle', id: 'veh-1', op: 'create' },
      { entity: 'Customer', id: 'cust-1', op: 'update' },
      { entity: 'WorkshopOrder', id: 'wo-1', op: 'create' },
      { entity: 'Vehicle', id: 'veh-1', op: 'delete' },
    ];

    for (const item of items) {
      collector.recordChange(item);
    }

    expect(collector.getChanges()).toEqual(items);
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
      { entity: 'Customer', id: 'cust-1', op: 'create' },
      { entity: 'Vehicle', id: 'veh-1', op: 'create' },
      { entity: 'Customer', id: 'cust-1', op: 'update' },
    ]);
  });

  it('returns a defensive copy of changes array', () => {
    collector.recordChange({ entity: 'Customer', id: 'cust-1', op: 'create' });
    const changes = collector.getChanges();
    changes.push({ entity: 'Fake', id: 'fake-1', op: 'delete' });

    expect(collector.getChanges()).toHaveLength(1);
    expect(collector.getChanges()[0]).toEqual({
      entity: 'Customer',
      id: 'cust-1',
      op: 'create',
    });
  });

  it('clears recorded changes when clear() is called', () => {
    collector.recordChange({ entity: 'Customer', id: 'cust-1', op: 'create' });
    expect(collector.getChanges()).toHaveLength(1);

    collector.clear();
    expect(collector.getChanges()).toEqual([]);
  });
});

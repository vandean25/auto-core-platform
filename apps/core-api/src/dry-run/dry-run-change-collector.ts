import type { WouldChangeItem, WouldChangeRecord } from './dry-run.types.js';

export class DryRunChangeCollector {
  private readonly changes: WouldChangeItem[] = [];
  private readonly seenKeys = new Set<string>();
  private readonly createdRowKeys = new Set<string>();

  recordChange(change: WouldChangeRecord): void {
    const rowKey = `${change.entity}:${change.id}`;
    const key = `${rowKey}:${change.op}`;
    if (!this.seenKeys.has(key)) {
      this.seenKeys.add(key);
      if (change.op === 'create') {
        this.createdRowKeys.add(rowKey);
      }
      // A row the preview created is rolled back, so its id is provisional. A change to such a row is
      // provisional too. A change to an existing row keeps its committed id.
      this.changes.push({
        ...change,
        provisional: this.createdRowKeys.has(rowKey),
      });
    }
  }

  getChanges(): WouldChangeItem[] {
    return [...this.changes];
  }

  clear(): void {
    this.changes.length = 0;
    this.seenKeys.clear();
    this.createdRowKeys.clear();
  }
}

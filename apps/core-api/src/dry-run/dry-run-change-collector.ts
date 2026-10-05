import type { WouldChangeItem } from './dry-run.types.js';

export class DryRunChangeCollector {
  private readonly changes: WouldChangeItem[] = [];
  private readonly seenKeys = new Set<string>();

  recordChange(item: WouldChangeItem): void {
    const key = `${item.entity}:${item.id}:${item.op}`;
    if (!this.seenKeys.has(key)) {
      this.seenKeys.add(key);
      this.changes.push({ ...item });
    }
  }

  getChanges(): WouldChangeItem[] {
    return [...this.changes];
  }

  clear(): void {
    this.changes.length = 0;
    this.seenKeys.clear();
  }
}

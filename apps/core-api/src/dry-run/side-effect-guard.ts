import { DryRunStorage } from './dry-run.storage.js';
import type { SideEffectType } from './dry-run.types.js';

export class DryRunSideEffectBlockedException extends Error {
  constructor(public readonly effect: SideEffectType) {
    super(
      `[DryRun] Side effect '${effect}' is blocked during dry run execution.`,
    );
    this.name = 'DryRunSideEffectBlockedException';
  }
}

export class SideEffectGuard {
  static isDryRun(): boolean {
    return DryRunStorage.isDryRun();
  }

  static assertAllowed(effect: SideEffectType): void {
    if (this.isDryRun()) {
      throw new DryRunSideEffectBlockedException(effect);
    }
  }
}

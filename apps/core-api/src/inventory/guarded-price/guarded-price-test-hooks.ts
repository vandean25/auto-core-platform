/** E2E-only fault injection for guarded price Tx-E (never honored outside Jest workers). */

type GuardedPriceTestHookState = {
  failTxEAfterJournalLock: boolean;
  failTxEAfterCatalogUpdate: boolean;
  holdTxEOpenAfterJournalLock: boolean;
  txERelease: (() => void) | null;
  onTxEJournalLocked: (() => void) | null;
};

const GLOBAL_HOOK_KEY = '__acpGuardedPriceTestHooks';

function guardedPriceTestHookState(): GuardedPriceTestHookState {
  const globalRef = globalThis as unknown as Record<
    string,
    GuardedPriceTestHookState
  >;
  if (!globalRef[GLOBAL_HOOK_KEY]) {
    globalRef[GLOBAL_HOOK_KEY] = {
      failTxEAfterJournalLock: false,
      failTxEAfterCatalogUpdate: false,
      holdTxEOpenAfterJournalLock: false,
      txERelease: null,
      onTxEJournalLocked: null,
    };
  }
  return globalRef[GLOBAL_HOOK_KEY];
}

export const guardedPriceTestHooks = guardedPriceTestHookState();

export function shouldFailTxEAfterJournalLock(): boolean {
  return (
    process.env.JEST_WORKER_ID !== undefined &&
    guardedPriceTestHooks.failTxEAfterJournalLock
  );
}

export function shouldFailTxEAfterCatalogUpdate(): boolean {
  return (
    process.env.JEST_WORKER_ID !== undefined &&
    guardedPriceTestHooks.failTxEAfterCatalogUpdate
  );
}

export function shouldHoldTxEOpenAfterJournalLock(): boolean {
  return guardedPriceTestHooks.holdTxEOpenAfterJournalLock;
}

export async function waitForTxEReleaseIfHeld(): Promise<void> {
  if (!shouldHoldTxEOpenAfterJournalLock()) {
    return;
  }
  await new Promise<void>((resolve) => {
    guardedPriceTestHooks.txERelease = resolve;
  });
}

export function releaseHeldTxE(): void {
  guardedPriceTestHooks.txERelease?.();
  guardedPriceTestHooks.txERelease = null;
  guardedPriceTestHooks.holdTxEOpenAfterJournalLock = false;
}

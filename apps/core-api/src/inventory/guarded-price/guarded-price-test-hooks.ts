/** E2E-only fault injection for guarded price Tx-E (never honored outside Jest workers). */

type GuardedPriceTestHookState = {
  failTxEAfterJournalLock: boolean;
  failTxEAfterCatalogUpdate: boolean;
  holdTxEOpenAfterJournalLock: boolean;
  holdTxEOpenAfterCatalogUpdate: boolean;
  txERelease: (() => void) | null;
  txECatalogRelease: (() => void) | null;
  onTxEJournalLocked: (() => void) | null;
  onTxECatalogUpdated: (() => void) | null;
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
      holdTxEOpenAfterCatalogUpdate: false,
      txERelease: null,
      txECatalogRelease: null,
      onTxEJournalLocked: null,
      onTxECatalogUpdated: null,
    };
  }
  const state = globalRef[GLOBAL_HOOK_KEY];
  state.holdTxEOpenAfterCatalogUpdate ??= false;
  state.txECatalogRelease ??= null;
  state.onTxECatalogUpdated ??= null;
  return state;
}

export const guardedPriceTestHooks = guardedPriceTestHookState();

export function shouldFailTxEAfterJournalLock(): boolean {
  return guardedPriceTestHooks.failTxEAfterJournalLock;
}

export function shouldFailTxEAfterCatalogUpdate(): boolean {
  return guardedPriceTestHooks.failTxEAfterCatalogUpdate;
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

export function shouldHoldTxEOpenAfterCatalogUpdate(): boolean {
  return guardedPriceTestHooks.holdTxEOpenAfterCatalogUpdate;
}

export async function waitForTxECatalogReleaseIfHeld(): Promise<void> {
  if (!shouldHoldTxEOpenAfterCatalogUpdate()) {
    return;
  }
  await new Promise<void>((resolve) => {
    guardedPriceTestHooks.txECatalogRelease = resolve;
  });
}

export function releaseHeldTxE(): void {
  guardedPriceTestHooks.txERelease?.();
  guardedPriceTestHooks.txERelease = null;
  guardedPriceTestHooks.holdTxEOpenAfterJournalLock = false;
}

export function releaseHeldTxECatalog(): void {
  guardedPriceTestHooks.txECatalogRelease?.();
  guardedPriceTestHooks.txECatalogRelease = null;
  guardedPriceTestHooks.holdTxEOpenAfterCatalogUpdate = false;
}

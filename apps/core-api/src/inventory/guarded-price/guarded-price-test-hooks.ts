/** E2E-only fault injection for guarded price Tx-E (never honored outside Jest workers). */
export const guardedPriceTestHooks = {
  failTxEAfterJournalLock: false,
  failTxEAfterCatalogUpdate: false,
  holdTxAOpenAfterAcceptInsert: false,
  txARelease: null as (() => void) | null,
  onTxAHeld: null as (() => void) | null,
};

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

export function shouldHoldTxAOpenAfterAcceptInsert(): boolean {
  return (
    process.env.JEST_WORKER_ID !== undefined &&
    guardedPriceTestHooks.holdTxAOpenAfterAcceptInsert
  );
}

export async function waitForTxAReleaseIfHeld(): Promise<void> {
  if (!shouldHoldTxAOpenAfterAcceptInsert()) {
    return;
  }
  guardedPriceTestHooks.onTxAHeld?.();
  await new Promise<void>((resolve) => {
    guardedPriceTestHooks.txARelease = resolve;
  });
}

export function releaseHeldTxA(): void {
  guardedPriceTestHooks.txARelease?.();
  guardedPriceTestHooks.txARelease = null;
  guardedPriceTestHooks.holdTxAOpenAfterAcceptInsert = false;
}

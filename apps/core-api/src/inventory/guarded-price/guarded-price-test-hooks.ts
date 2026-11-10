/** E2E-only fault injection for guarded price Tx-E (never honored outside Jest workers). */
export const guardedPriceTestHooks = {
  failTxEAfterJournalLock: false,
  failTxEAfterCatalogUpdate: false,
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

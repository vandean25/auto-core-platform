/**
 * Hook point for a persisted query cache. core-web keeps the query cache in memory only today; if a persisted cache
 * is added, clear it here so no user or tenant data survives on a shared device.
 */
export function clearPersistedQueryCache(): void {
  // Nothing is persisted yet.
}

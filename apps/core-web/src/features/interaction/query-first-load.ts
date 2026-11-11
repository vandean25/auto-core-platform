/** True while TanStack is actively fetching the first payload (v5 `isLoading`, not paused pending). */
export function isAwaitingFirstQueryPayload(
  isPending: boolean,
  payloadReady: boolean,
  isFetching?: boolean,
): boolean {
  const activelyFetching = isFetching ?? isPending
  return isPending && activelyFetching && !payloadReady
}

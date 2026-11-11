/** True while a TanStack query is pending and has not produced a payload yet (AUT-971). */
export function isAwaitingFirstQueryPayload(isPending: boolean, payloadReady: boolean): boolean {
  return isPending && !payloadReady
}

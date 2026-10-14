import type { ManagerOptions, SocketOptions } from 'socket.io-client'

export type RealtimeSocketOptionsInput = {
  path: string
  getIdToken: () => Promise<string | null>
}

/**
 * Socket.IO client options for the dashboard realtime namespace.
 *
 * Long-polling only. The runbook records that Firebase Hosting's `/api/**`
 * rewrite does not forward WebSocket upgrades. That was not re-verified against
 * Firebase documentation (AUT-432), but it matches the HTTP 400 handshakes seen
 * with a WebSocket-first client. Polling sessions must stay on one Cloud Run
 * replica (session affinity). See
 * docs/internal/05-Runbooks/socketio-redis-scaling-runbook.md, sections 1 and 4.
 */
export function buildRealtimeSocketOptions({
  path,
  getIdToken,
}: RealtimeSocketOptionsInput): Partial<ManagerOptions & SocketOptions> {
  return {
    path,
    transports: ['polling'],
    upgrade: false,
    withCredentials: true,
    // Socket.IO calls this on every (re)connect. A reconnect after the Firebase
    // ID token expires (about an hour) therefore presents a current token.
    auth: (callback) => {
      void getIdToken().then(
        (idToken) => callback(idToken ? { token: idToken } : {}),
        () => callback({}),
      )
    },
    // Exponential backoff from 1 s, capped at 30 s, with +/-50% jitter. Attempts
    // stay unlimited so realtime recovers after a deploy or an outage.
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 30_000,
    randomizationFactor: 0.5,
  }
}

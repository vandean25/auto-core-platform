import type { ManagerOptions, SocketOptions } from 'socket.io-client'

export type RealtimeSocketOptionsInput = {
  path: string
  getIdToken: () => Promise<string | null>
}

/**
 * Socket.IO client options for the dashboard realtime namespace.
 *
 * Long-polling only. Firebase Hosting forwards `/api/**` to Cloud Run without
 * forwarding WebSocket upgrades, so a WebSocket-first client fails every
 * handshake with HTTP 400. Polling sessions must stay on one Cloud Run replica
 * (session affinity). See docs/internal/05-Runbooks/socketio-redis-scaling-runbook.md.
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

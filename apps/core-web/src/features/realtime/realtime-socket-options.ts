import type { ManagerOptions, SocketOptions } from 'socket.io-client'

export const REALTIME_RECONNECT_MIN_MS = 1_000
export const REALTIME_RECONNECT_MAX_MS = 30_000

export type RealtimeSocketOptionsInput = {
  path: string
  getIdToken: () => Promise<string | null>
}

export type HandshakeRetry = {
  onConnectError: () => void
  onConnect: () => void
  dispose: () => void
}

/**
 * Socket.IO client options for the dashboard realtime namespace.
 *
 * Long-polling only. Assumed, unverified: Firebase Hosting's `/api/**` rewrite
 * does not forward WebSocket upgrades. The assumption was not checked against
 * Firebase documentation in AUT-432. It fits the HTTP 400 handshakes seen with a
 * WebSocket-first client. Polling sessions must stay on one Cloud Run replica
 * (session affinity). See
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
    reconnectionDelay: REALTIME_RECONNECT_MIN_MS,
    reconnectionDelayMax: REALTIME_RECONNECT_MAX_MS,
    randomizationFactor: 0.5,
  }
}

/**
 * Retries a socket after a rejected handshake. socket.io-client destroys the
 * socket on a server-rejected handshake (CONNECT_ERROR) and does not reconnect
 * it, so a token that could not be refreshed would leave realtime off until the
 * provider re-ran. Engine-level errors also emit connect_error, but the socket
 * stays active there and the Manager reconnects by itself, so the retry runs
 * only when `socket.active` is false. It reschedules `socket.connect()` with the
 * same bounded backoff as transport reconnects: doubling from 1 s, capped at
 * 30 s, with up to 50% jitter. A successful connection restarts the backoff.
 */
export function createHandshakeRetry(
  socket: { connect: () => unknown; active: boolean },
  random: () => number = Math.random,
): HandshakeRetry {
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  return {
    onConnectError() {
      if (socket.active || timer !== undefined) return
      const base = Math.min(
        REALTIME_RECONNECT_MAX_MS,
        REALTIME_RECONNECT_MIN_MS * 2 ** attempts,
      )
      const jitter = base * 0.5 * (random() * 2 - 1)
      attempts += 1
      timer = setTimeout(() => {
        timer = undefined
        socket.connect()
      }, Math.min(REALTIME_RECONNECT_MAX_MS, base + jitter))
    },
    onConnect() {
      attempts = 0
      clearTimer()
    },
    dispose: clearTimer,
  }
}

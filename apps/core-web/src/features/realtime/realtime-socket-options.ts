import type { ManagerOptions, SocketOptions } from 'socket.io-client'

export const REALTIME_RECONNECT_MIN_MS = 1_000
export const REALTIME_RECONNECT_MAX_MS = 30_000

export type RealtimeSocketOptionsInput = {
  path: string
  getIdToken: () => Promise<string | null>
  /**
   * The socket connects straight to the core-api origin (`VITE_SOCKET_BASE_URL`), not through Firebase Hosting.
   * Then it uses WebSocket first with polling as the fallback.
   */
  direct?: boolean
}

export type HandshakeRetry = {
  onConnectError: () => void
  onConnect: () => void
  dispose: () => void
}

/**
 * Socket.IO client options for the dashboard realtime namespace.
 *
 * Through Firebase Hosting (no `VITE_SOCKET_BASE_URL`): long-polling only.
 * Hosting's `/api/**` rewrite does not proxy WebSocket upgrades (a WebSocket
 * upgrade through web.app returns 400, directly on run.app it returns 101), and it
 * strips the Cloud Run session-affinity cookie, so polling sessions can jump
 * between core-api instances. This stays the default for local dev and e2e.
 *
 * Direct to the core-api origin (`direct`): WebSocket first, polling as the
 * fallback. A WebSocket session needs no affinity. The Firebase ID token travels
 * in the handshake `auth` payload, so cross-origin works without the Hosting
 * `__session` cookie; `withCredentials` only lets the polling fallback carry the
 * Cloud Run affinity cookie. See
 * docs/internal/05-Runbooks/socketio-redis-scaling-runbook.md, sections 1 and 4.
 */
export function buildRealtimeSocketOptions({
  path,
  getIdToken,
  direct = false,
}: RealtimeSocketOptionsInput): Partial<ManagerOptions & SocketOptions> {
  return {
    path,
    ...(direct ? { transports: ['websocket', 'polling'] } : { transports: ['polling'], upgrade: false }),
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

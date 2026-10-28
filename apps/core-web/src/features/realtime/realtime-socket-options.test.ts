import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildRealtimeSocketOptions, createHandshakeRetry } from './realtime-socket-options'

type AuthCallback = (data: object) => void

function readAuthPayload(auth: unknown): Promise<object> {
  return new Promise((resolve) => {
    ;(auth as (callback: AuthCallback) => void)(resolve)
  })
}

describe('buildRealtimeSocketOptions', () => {
  it('connects with long-polling only so no WebSocket upgrade is attempted through Hosting', () => {
    const options = buildRealtimeSocketOptions({ path: '/api/socket.io', getIdToken: vi.fn() })

    expect(options.transports).toEqual(['polling'])
    expect(options.upgrade).toBe(false)
  })

  it('connects WebSocket first with polling as the fallback when the socket goes straight to core-api', () => {
    const options = buildRealtimeSocketOptions({ path: '/api/socket.io', getIdToken: vi.fn(), direct: true })

    expect(options.transports).toEqual(['websocket', 'polling'])
    expect(options).not.toHaveProperty('upgrade')
    expect(options.withCredentials).toBe(true)
  })

  it('keeps the same auth payload and backoff for a direct connection', async () => {
    const options = buildRealtimeSocketOptions({
      path: '/api/socket.io',
      getIdToken: vi.fn().mockResolvedValue('token-1'),
      direct: true,
    })

    expect(await readAuthPayload(options.auth)).toEqual({ token: 'token-1' })
    expect(options.reconnectionDelay).toBe(1_000)
    expect(options.reconnectionDelayMax).toBe(30_000)
  })

  it('keeps the socket path and sends credentials', () => {
    const options = buildRealtimeSocketOptions({ path: '/socket.io', getIdToken: vi.fn() })

    expect(options.path).toBe('/socket.io')
    expect(options.withCredentials).toBe(true)
  })

  it('bounds reconnect backoff between 1 s and 30 s without capping the number of attempts', () => {
    const options = buildRealtimeSocketOptions({ path: '/api/socket.io', getIdToken: vi.fn() })

    expect(options.reconnectionDelay).toBe(1_000)
    expect(options.reconnectionDelayMax).toBe(30_000)
    expect(options.randomizationFactor).toBe(0.5)
    expect(options).not.toHaveProperty('reconnection')
    expect(options).not.toHaveProperty('reconnectionAttempts')
  })

  it('presents a freshly issued ID token on every (re)connect', async () => {
    const getIdToken = vi.fn().mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2')
    const options = buildRealtimeSocketOptions({ path: '/api/socket.io', getIdToken })

    const first = await readAuthPayload(options.auth)
    const second = await readAuthPayload(options.auth)

    expect(first).toEqual({ token: 'token-1' })
    expect(second).toEqual({ token: 'token-2' })
    expect(getIdToken).toHaveBeenCalledTimes(2)
  })

  it('sends an empty auth payload when no user is signed in so the server rejects the handshake', async () => {
    const options = buildRealtimeSocketOptions({
      path: '/api/socket.io',
      getIdToken: vi.fn().mockResolvedValue(null),
    })

    expect(await readAuthPayload(options.auth)).toEqual({})
  })

  it('sends an empty auth payload when the token refresh fails, so the server rejects the handshake and the retry takes over', async () => {
    const options = buildRealtimeSocketOptions({
      path: '/api/socket.io',
      getIdToken: vi.fn().mockRejectedValue(new Error('network unavailable')),
    })

    expect(await readAuthPayload(options.auth)).toEqual({})
  })
})

describe('createHandshakeRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function expectReconnectAfter(
    socket: { connect: () => unknown; active: boolean },
    retry: ReturnType<typeof createHandshakeRetry>,
    delayMs: number,
  ) {
    const connect = socket.connect as ReturnType<typeof vi.fn>
    const callsBefore = connect.mock.calls.length

    retry.onConnectError()
    vi.advanceTimersByTime(delayMs - 1)
    expect(connect).toHaveBeenCalledTimes(callsBefore)

    vi.advanceTimersByTime(1)
    expect(connect).toHaveBeenCalledTimes(callsBefore + 1)
  }

  it('reconnects after a rejected handshake, with delays that double from 1 s and cap at 30 s', () => {
    const socket = { connect: vi.fn(), active: false }
    // A random value of 0.5 gives zero jitter, so the delays are exact.
    const retry = createHandshakeRetry(socket, () => 0.5)

    expectReconnectAfter(socket, retry, 1_000)
    expectReconnectAfter(socket, retry, 2_000)
    expectReconnectAfter(socket, retry, 4_000)
    expectReconnectAfter(socket, retry, 8_000)
    expectReconnectAfter(socket, retry, 16_000)
    expectReconnectAfter(socket, retry, 30_000)
    expectReconnectAfter(socket, retry, 30_000)
  })

  it('adds up to +50% jitter to each delay and never exceeds the 30 s cap', () => {
    const socket = { connect: vi.fn(), active: false }
    // A random value of 1 gives the maximum upward jitter, so each base delay
    // (1, 2, 4, 8, 16, 30 s) grows by half, and the cap then holds at 30 s.
    const retry = createHandshakeRetry(socket, () => 1)

    expectReconnectAfter(socket, retry, 1_500)
    expectReconnectAfter(socket, retry, 3_000)
    expectReconnectAfter(socket, retry, 6_000)
    expectReconnectAfter(socket, retry, 12_000)
    expectReconnectAfter(socket, retry, 24_000)
    expectReconnectAfter(socket, retry, 30_000)
    expectReconnectAfter(socket, retry, 30_000)
  })

  it('schedules a single reconnect while one is already pending', () => {
    const socket = { connect: vi.fn(), active: false }
    const retry = createHandshakeRetry(socket, () => 0.5)

    retry.onConnectError()
    retry.onConnectError()
    vi.advanceTimersByTime(1_000)

    expect(socket.connect).toHaveBeenCalledTimes(1)
  })

  it('restarts from 1 s after a successful connection', () => {
    const socket = { connect: vi.fn(), active: false }
    const retry = createHandshakeRetry(socket, () => 0.5)

    expectReconnectAfter(socket, retry, 1_000)
    expectReconnectAfter(socket, retry, 2_000)

    retry.onConnect()

    expectReconnectAfter(socket, retry, 1_000)
  })

  it('does not retry while the socket is still active, because the Manager handles engine-level errors', () => {
    const socket = { connect: vi.fn(), active: true }
    const retry = createHandshakeRetry(socket, () => 0.5)

    retry.onConnectError()
    vi.advanceTimersByTime(60_000)

    expect(socket.connect).not.toHaveBeenCalled()
  })

  it('retries a rejected handshake once socket.io-client has deactivated the socket', () => {
    const socket = { connect: vi.fn(), active: true }
    const retry = createHandshakeRetry(socket, () => 0.5)

    retry.onConnectError()
    vi.advanceTimersByTime(60_000)
    expect(socket.connect).not.toHaveBeenCalled()

    // A rejected handshake makes socket.io-client destroy the socket, which clears its subscriptions.
    socket.active = false
    expectReconnectAfter(socket, retry, 1_000)
  })

  it('cancels a pending reconnect when disposed', () => {
    const socket = { connect: vi.fn(), active: false }
    const retry = createHandshakeRetry(socket, () => 0.5)

    retry.onConnectError()
    retry.dispose()
    vi.advanceTimersByTime(60_000)

    expect(socket.connect).not.toHaveBeenCalled()
  })
})

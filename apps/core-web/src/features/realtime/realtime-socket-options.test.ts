import { describe, expect, it, vi } from 'vitest'
import { buildRealtimeSocketOptions } from './realtime-socket-options'

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

  it('sends an empty auth payload when the token refresh fails instead of leaving the handshake pending', async () => {
    const options = buildRealtimeSocketOptions({
      path: '/api/socket.io',
      getIdToken: vi.fn().mockRejectedValue(new Error('network unavailable')),
    })

    expect(await readAuthPayload(options.auth)).toEqual({})
  })
})

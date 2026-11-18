// @vitest-environment node
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { generateId, generateUuidV7 } from './id'

describe('generateId', () => {
  let originalRandomUUID: typeof crypto.randomUUID | undefined;

  beforeEach(() => {
    // Save the original randomUUID function
    if (typeof crypto !== 'undefined') {
      originalRandomUUID = crypto.randomUUID;
    }
  });

  afterEach(() => {
    // Restore randomUUID after each test
    if (typeof crypto !== 'undefined') {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: originalRandomUUID,
        writable: true,
        configurable: true
      })
    }
  })

  it('generates a valid UUID v4 format using crypto.randomUUID', () => {
    const id = generateId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('generates a valid UUID v4 format using fallback when crypto.randomUUID is not available', () => {
    // Mock crypto.randomUUID to be undefined to force fallback
    if (typeof crypto !== 'undefined') {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: undefined,
        writable: true,
        configurable: true
      })
    }

    const id = generateId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('generates reasonably unique IDs using fallback', () => {
    if (typeof crypto !== 'undefined') {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: undefined,
        writable: true,
        configurable: true
      })
    }

    const ids = new Set()
    for (let i = 0; i < 100; i++) {
      ids.add(generateId())
    }
    expect(ids.size).toBe(100)
  })
})

describe('generateUuidV7', () => {
  it('generates a valid RFC 9562 UUIDv7 embedding the unix-ms timestamp', () => {
    const before = Date.now()
    const id = generateUuidV7()
    const after = Date.now()

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const hex = id.replace(/-/g, '')
    const embeddedMs = Number(BigInt(`0x${hex.slice(0, 12)}`))
    expect(embeddedMs).toBeGreaterThanOrEqual(before)
    expect(embeddedMs).toBeLessThanOrEqual(after)
  })

  it('generates unique UUIDv7 values within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUuidV7()))
    expect(ids.size).toBe(100)
  })
})

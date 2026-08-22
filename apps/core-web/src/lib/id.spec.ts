import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { generateId } from './id'

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
      Object.defineProperty(global.crypto, 'randomUUID', {
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
      Object.defineProperty(global.crypto, 'randomUUID', {
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
      Object.defineProperty(global.crypto, 'randomUUID', {
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

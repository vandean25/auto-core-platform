import { describe, expect, it } from 'vitest'

import { assertBlobMatchesSha256, computeBlobSha256Hex } from './useAccountingExports'
import { getErrorStatus } from '@/lib/error-utils'

describe('computeBlobSha256Hex', () => {
  it('matches known SHA-256 for empty content', async () => {
    const blob = new Blob([''], { type: 'text/plain' })
    await expect(computeBlobSha256Hex(blob)).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  it('hashes CSV bytes deterministically', async () => {
    const blob = new Blob(['EXTF;700;21;Buchungsstapel'], { type: 'text/csv' })
    const hash = await computeBlobSha256Hex(blob)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[a-f0-9]+$/)
  })
})

describe('assertBlobMatchesSha256', () => {
  it('accepts matching expected and header hashes case-insensitively', () => {
    expect(() =>
      assertBlobMatchesSha256(
        'AbC123',
        'abc123',
        null,
      ),
    ).not.toThrow()
  })

  it('rejects mismatched bytes', () => {
    try {
      assertBlobMatchesSha256('deadbeef', 'cafebabe', null)
      expect.fail('expected checksum mismatch')
    } catch (error: unknown) {
      expect(getErrorStatus(error)).toBe(422)
    }
  })

  it('rejects when no reference checksum is available', () => {
    try {
      assertBlobMatchesSha256('deadbeef', null, null)
      expect.fail('expected missing checksum failure')
    } catch (error: unknown) {
      expect(getErrorStatus(error)).toBe(422)
    }
  })
})

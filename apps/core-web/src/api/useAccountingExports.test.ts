import { describe, expect, it } from 'vitest'

import { computeBlobSha256Hex } from './useAccountingExports'

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

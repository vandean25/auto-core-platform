import { describe, expect, it } from 'vitest'
import { resolveApiUrl } from './client'

describe('resolveApiUrl', () => {
  it('preserves relative API paths when no API base URL is configured', () => {
    const input = '/api/auth/me'

    expect(resolveApiUrl(input)).toBe(input)
  })

  it('preserves URL API paths when no API base URL is configured', () => {
    const input = new URL('https://auto-core-platform-vande.web.app/api/auth/me?refresh=true')

    expect(resolveApiUrl(input)).toBe(input)
  })
})

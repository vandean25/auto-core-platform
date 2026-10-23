// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  getSearchPrefixes,
  isSearchableQuery,
  parseSearchInput,
  SEARCH_TYPE_REGISTRY,
} from './global-search-types'

describe('parseSearchInput', () => {
  it.each([
    ['k:Muster', 'Muster', ['customer']],
    ['fz: W-123', 'W-123', ['vehicle', 'stock_vehicle']],
    ['a:WO-2026-0004', 'WO-2026-0004', ['workshop_order']],
    ['r:RE-2026-0012', 'RE-2026-0012', ['invoice']],
    ['T:bremse', 'bremse', ['part']],
  ])('maps the prefix of %s to its types and strips it', (input, q, types) => {
    expect(parseSearchInput(input)).toEqual({ q, types })
  })

  it('searches every type when there is no known prefix', () => {
    expect(parseSearchInput('  golf  ')).toEqual({ q: 'golf' })
    expect(parseSearchInput('x:golf')).toEqual({ q: 'x:golf' })
  })

  it('keeps the prefix type when nothing follows it', () => {
    expect(parseSearchInput('k:')).toEqual({ q: '', types: ['customer'] })
  })

  it('caps the query at the 100 characters the backend accepts', () => {
    expect(parseSearchInput('a'.repeat(150)).q).toHaveLength(100)
  })
})

describe('isSearchableQuery', () => {
  it('needs two characters, or one for digits only', () => {
    expect(isSearchableQuery('')).toBe(false)
    expect(isSearchableQuery('a')).toBe(false)
    expect(isSearchableQuery('ab')).toBe(true)
    expect(isSearchableQuery('7')).toBe(true)
    expect(isSearchableQuery('7a')).toBe(true)
  })
})

describe('search type registry', () => {
  it('lists one help entry per prefix in registry order', () => {
    expect(getSearchPrefixes().map((entry) => entry.prefix)).toEqual(['k', 'fz', 'a', 'r', 't'])
  })

  it('has an icon and a label for every type', () => {
    for (const entry of Object.values(SEARCH_TYPE_REGISTRY)) {
      expect(entry.icon).toBeDefined()
      expect(entry.labelKey).toMatch(/^nav:globalSearch\.groups\./)
    }
  })
})

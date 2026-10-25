import { describe, expect, it } from 'vitest'
import { resolveNumberInputMode } from './number-input-mode'

describe('resolveNumberInputMode', () => {
  it('returns undefined for non-number types', () => {
    expect(resolveNumberInputMode('text')).toBeUndefined()
  })

  it('defaults number inputs to decimal', () => {
    expect(resolveNumberInputMode('number')).toBe('decimal')
    expect(resolveNumberInputMode('number', '0.01')).toBe('decimal')
    expect(resolveNumberInputMode('number', 'any')).toBe('decimal')
  })

  it('uses numeric for whole-number steps', () => {
    expect(resolveNumberInputMode('number', 1)).toBe('numeric')
    expect(resolveNumberInputMode('number', '1')).toBe('numeric')
  })

  it('respects an explicit inputMode', () => {
    expect(resolveNumberInputMode('number', '1', 'decimal')).toBe('decimal')
  })
})

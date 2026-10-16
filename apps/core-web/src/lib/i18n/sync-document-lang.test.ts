import { describe, expect, it } from 'vitest'
import { syncDocumentLang } from './sync-document-lang'

describe('syncDocumentLang', () => {
  it('sets html lang attribute', () => {
    syncDocumentLang('en')
    expect(document.documentElement.lang).toBe('en')
    syncDocumentLang('de')
    expect(document.documentElement.lang).toBe('de')
  })
})

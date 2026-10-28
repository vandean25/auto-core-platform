import { describe, expect, it } from 'vitest'
import deAgent from '../../../../../locales/de/agent.json'
import enAgent from '../../../../../locales/en/agent.json'

describe('agent copy names the suggestions plainly', () => {
  it('uses "KI-Vorschläge" / "AI suggestions" in the shadow-mode description', () => {
    const description = (copy: unknown) => JSON.stringify(copy)
    expect(description(deAgent)).toContain('KI-Vorschläge')
    expect(description(deAgent)).not.toContain('Jev')
    expect(description(enAgent)).toContain('AI suggestions')
    expect(description(enAgent)).not.toContain('Jev')
  })
})

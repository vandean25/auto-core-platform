import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../../../../')
const agentsMd = readFileSync(path.join(repoRoot, 'agents.md'), 'utf8')
const acpTesting = readFileSync(
  path.join(repoRoot, '.agents/skills/acp-testing/SKILL.md'),
  'utf8',
)
const acpUiPolish = readFileSync(
  path.join(repoRoot, '.agents/skills/acp-ui-polish/SKILL.md'),
  'utf8',
)

describe('agent rules alignment across agents.md, acp-testing, and acp-ui-polish', () => {
  it('aligns on THEN screenshots via testInfo.attach at desktop and 375px with no PR-body images', () => {
    expect(agentsMd).toContain('testInfo.attach')
    expect(agentsMd).toMatch(/do not.*paste image links/i)

    expect(acpTesting).toContain('testInfo.attach')
    expect(acpTesting).toContain('one THEN screenshot per viewport')
    expect(acpTesting).toContain('desktop')
    expect(acpTesting).toContain('375 px')
    expect(acpTesting).toMatch(/never commit PNGs or paste image links/i)
    expect(acpTesting).toContain("testInfo.attach('feature-state-de-1280'")
    expect(acpTesting).toContain("testInfo.attach('feature-state-de-375'")

    expect(acpUiPolish).toContain('testInfo.attach')
    expect(acpUiPolish).toContain('desktop and 375 px')
    expect(acpUiPolish).toMatch(/Do not commit screenshots or paste image links/i)
    expect(acpUiPolish).not.toMatch(/before\/after images in the PR body/i)
    expect(acpUiPolish).not.toContain('390px')
  })

  it('aligns on 44x44 CSS px touch targets below sm (max-sm:min-h-11, max-sm:min-w-11) with dense desktop', () => {
    expect(acpUiPolish).toContain('max-sm:min-h-11')
    expect(acpUiPolish).toContain('max-sm:min-w-11')
    expect(acpUiPolish).toContain('44 × 44 CSS px')
    expect(acpUiPolish).toMatch(/Desktop.*may stay dense.*h-8.*h-9/i)

    expect(agentsMd).not.toMatch(/touch target.*(?:24|36)\s*px/i)
    expect(acpTesting).not.toMatch(/touch target.*(?:24|36)\s*px/i)
  })

  it('aligns on list create-button labels using a <Plus> icon or leading + and never both', () => {
    expect(agentsMd).toMatch(/plus icon \*\*or\*\* a leading `\+` in the label, never both/i)
    expect(agentsMd).toContain('<Plus>')
    expect(agentsMd).not.toMatch(/plus icon.*and.*label.*\+ <Entity>/i)

    expect(acpTesting).not.toMatch(/\+ <Entity>/)
    expect(acpUiPolish).not.toMatch(/\+ <Entity>/)
  })
})

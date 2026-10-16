import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const webRoot = path.resolve(import.meta.dirname, '..')
const ruleId = 'no-restricted-syntax'
const eslint = new ESLint({ cwd: webRoot })

async function lintMessages(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages
}

describe('no direct Intl formatting (AUT-577)', () => {
  it('fails on Intl.NumberFormat outside lib/format', async () => {
    const messages = await lintMessages(
      `export const x = new Intl.NumberFormat('de-AT').format(1)`,
      path.join(webRoot, 'src/pages/ExamplePage.tsx'),
    )
    expect(messages.some((message) => message.ruleId === ruleId)).toBe(true)
  })

  it('allows Intl inside lib/format', async () => {
    const messages = await lintMessages(
      `export const x = new Intl.NumberFormat('de-AT').format(1)`,
      path.join(webRoot, 'src/lib/format/intl-private.ts'),
    )
    expect(messages.filter((message) => message.ruleId === ruleId)).toEqual([])
  })

  it('fails on toLocaleDateString in components', async () => {
    const messages = await lintMessages(
      `export const x = new Date().toLocaleDateString()`,
      path.join(webRoot, 'src/components/Example.tsx'),
    )
    expect(messages.some((message) => message.ruleId === ruleId)).toBe(true)
  })
})

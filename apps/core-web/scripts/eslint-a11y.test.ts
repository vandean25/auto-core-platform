import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// AUT-471: icon-only buttons and links must carry an accessible name. These fixtures run through
// the real apps/core-web eslint.config.js, so they fail if the jsx-a11y rule is removed or loosened.
const webRoot = path.resolve(import.meta.dirname, '..')
const ruleId = 'jsx-a11y/control-has-associated-label'
const eslint = new ESLint({ cwd: webRoot })

async function lintMessages(code: string) {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(webRoot, 'src/__fixtures__/icon-control.tsx'),
  })
  return result.messages
}

/** AUT-578: global i18n literal warnings are expected on fixture snippets with English UI text. */
function messagesExceptI18nWarnings(messages: ESLint.LintResult['messages']) {
  return messages.filter((message) => message.ruleId !== 'i18next/no-literal-string')
}

async function namingViolations(code: string) {
  const messages = await lintMessages(code)
  return messages.filter((message) => message.ruleId === ruleId)
}

describe('jsx-a11y control naming (AUT-471)', () => {
  it('fails on an icon-only button with no accessible name', async () => {
    const violations = await namingViolations(`
      export const RemoveRow = ({ onRemove }: { onRemove: () => void }) => (
        <Button variant="ghost" size="icon" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )
    `)

    expect(violations).toHaveLength(1)
    expect(violations[0].message).toBe('A control must be associated with a text label.')
  })

  it('fails on an icon-only back link wrapped in a button', async () => {
    const violations = await namingViolations(`
      export const BackToOrders = () => (
        <Button variant="ghost" size="icon" asChild>
          <Link to="/sales-orders">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
      )
    `)

    expect(violations.length).toBeGreaterThan(0)
  })

  // The pass cases assert on every message, not only this rule's, so a parse error or an
  // ignored fixture file cannot pass by accident.
  it('passes when the icon-only button is named with aria-label', async () => {
    const messages = await lintMessages(`
      export const RemoveBrand = ({ name, onRemove }: { name: string; onRemove: () => void }) => (
        <Button variant="ghost" size="icon" aria-label={\`Delete brand \${name}\`} onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      )
    `)

    expect(messagesExceptI18nWarnings(messages)).toEqual([])
  })

  it('passes when the icon-only back link carries an aria-label', async () => {
    const messages = await lintMessages(`
      export const BackToOrders = () => (
        <Button variant="ghost" size="icon" asChild>
          <Link to="/sales-orders" aria-label="Back to sales orders">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
      )
    `)

    expect(messagesExceptI18nWarnings(messages)).toEqual([])
  })

  it('passes for a button whose visible text names it', async () => {
    const messages = await lintMessages(`
      export const CreateInvoice = () => (
        <Button size="lg" className="gap-2">
          <FileText className="h-4 w-4" /> Create Invoice
        </Button>
      )
    `)

    expect(messagesExceptI18nWarnings(messages)).toEqual([])
  })
})

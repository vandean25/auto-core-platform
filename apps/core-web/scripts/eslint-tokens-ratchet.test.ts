import path from 'node:path'
import { ESLint } from 'eslint'
import { beforeAll, describe, expect, it } from 'vitest'

const webRoot = path.resolve(import.meta.dirname, '..')
const eslint = new ESLint({ cwd: webRoot })
const migratedFile = path.join(webRoot, 'src/components/workshop/Example.tsx')

async function restrictedMessages(code: string, filePath = migratedFile) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax')
}

describe('design-token ratchet (AUT-659)', () => {
  // The first lintText call loads the whole flat config and its plugins.
  beforeAll(() => eslint.lintText('', { filePath: migratedFile }), 30_000)

  it.each([
    `export const A = () => <p className="text-sm text-slate-500">x</p>`,
    `export const A = () => <div className="hover:bg-amber-50 p-2">x</div>`,
    `export const A = () => <div className="border-l-4 border-l-rose-500">x</div>`,
    `export const A = () => <div className="bg-white">x</div>`,
    `export const A = ({ on }: { on: boolean }) => <div className={\`p-2 \${on ? 'x' : ''} text-red-600\`}>x</div>`,
    `export const styles = { warn: 'bg-blue-50/80 text-blue-700' }`,
  ])('fails on a palette class: %s', async (code) => {
    expect(await restrictedMessages(code)).not.toEqual([])
  })

  it('fails on an arbitrary font size', async () => {
    expect(await restrictedMessages(`export const A = () => <p className="text-[11px]">x</p>`)).not.toEqual([])
  })

  it('allows semantic tokens and the type scale', async () => {
    const code = `export const A = () => (
      <div className="border-border bg-muted/50 text-muted-foreground text-xs">
        <span className="bg-warning/10 text-warning border-success/30 text-destructive">x</span>
      </div>
    )`
    expect(await restrictedMessages(code)).toEqual([])
  })

  it('still enforces the Intl restriction in migrated folders', async () => {
    expect(await restrictedMessages(`export const x = new Intl.NumberFormat('de-AT').format(1)`)).not.toEqual([])
  })

  it('leaves folders that are not migrated yet alone', async () => {
    const code = `export const A = () => <p className="text-slate-500">x</p>`
    expect(await restrictedMessages(code, path.join(webRoot, 'src/pages/vehicles/Example.tsx'))).toEqual([])
  })
})

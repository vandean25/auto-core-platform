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

  // AUT-659 scenario: WHEN lint runs on the migrated folders THEN any palette class or text-[Npx] is an error.
  it.each([
    'src/pages/vehicles/Example.tsx',
    'src/components/vehicles/Example.tsx',
    'src/pages/vehicle-stock/Example.tsx',
    'src/components/vehicle-stock/Example.tsx',
    'src/features/vehicle-stock/listing/Example.tsx',
    'src/pages/customers/Example.tsx',
    'src/components/customers/Example.tsx',
    'src/pages/sales-orders/Example.tsx',
    'src/pages/sales/Example.tsx',
    'src/components/sales/Example.tsx',
    'src/features/sales/Example.tsx',
    'src/pages/finance/CreditNoteExample.tsx',
    'src/pages/finance/credit-note-example.tsx',
    'src/components/finance/create-credit-note-example.tsx',
    'src/components/finance/credit-note-example.tsx',
  ])('WHEN lint runs on the migrated folder %s THEN a palette class and text-[Npx] are errors', async (file) => {
    const filePath = path.join(webRoot, file)
    expect(await restrictedMessages(`export const A = () => <p className="text-slate-500">x</p>`, filePath)).not.toEqual([])
    expect(await restrictedMessages(`export const A = () => <p className="text-[11px]">x</p>`, filePath)).not.toEqual([])
  })

  it('leaves folders that are not migrated yet alone', async () => {
    const code = `export const A = () => <p className="text-slate-500">x</p>`
    expect(await restrictedMessages(code, path.join(webRoot, 'src/pages/vendors/Example.tsx'))).toEqual([])
  })
})

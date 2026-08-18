import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { inventoryKeys } from './inventory'
import { laborKeys } from './labor'
import { invoiceKeys } from './sales'
import { workshopKeys } from './workshop'

const apiDirectory = dirname(fileURLToPath(import.meta.url))

const QUERY_KEY_USAGE = /(?:queryKey\s*:\s*|setQueryData\s*\()\s*(\[[\s\S]*?\])/g

function apiSourceFiles() {
  return readdirSync(apiDirectory).filter(
    (fileName) => fileName.endsWith('.ts') && !fileName.endsWith('.test.ts') && !fileName.endsWith('.test.tsx'),
  )
}

function hardcodedQueryKeyUsages(source: string) {
  return [...source.matchAll(QUERY_KEY_USAGE)]
    .map((match) => match[1]?.replace(/\s+/g, ' ').trim())
    .filter((snippet): snippet is string => Boolean(snippet) && /['"`]/.test(snippet))
}

describe('invoiceKeys', () => {
  it('keeps invoice detail keys on the invoices prefix so invoice screens stay cache-aligned', () => {
    expect(invoiceKeys.all).toEqual(['invoices'])
    expect(invoiceKeys.detail('inv-1')).toEqual(['invoices', 'inv-1'])
  })
})

describe('laborKeys', () => {
  it('uses one factory for catalog search and settings operations under the labor prefix', () => {
    expect(laborKeys.all).toEqual(['labor'])
    expect(laborKeys.search('brake pads', 'wo-1')).toEqual(['labor', 'search', 'brake pads', 'wo-1'])
    expect(laborKeys.categories()).toEqual(['labor', 'categories'])
    expect(laborKeys.operation('op-1')).toEqual(['labor', 'operation', 'op-1'])
  })

  it('does not export a second laborKeys factory from workshop', async () => {
    const workshopApi = await import('./workshop')
    expect(workshopApi).not.toHaveProperty('laborKeys')
  })
})

describe('workshop and inventory factory keys', () => {
  it('identifies workshop order list and detail screens', () => {
    expect(workshopKeys.orders()).toEqual(['workshop', 'orders'])
    expect(workshopKeys.order('wo-1')).toEqual(['workshop', 'order', 'wo-1'])
  })

  it('identifies inventory lists so PO receipt can refresh stock screens', () => {
    expect(inventoryKeys.all).toEqual(['inventory'])
  })
})

describe('src/api query-key usage', () => {
  it('does not hardcode query key arrays outside factories', () => {
    const violations = apiSourceFiles().flatMap((fileName) => {
      const source = readFileSync(join(apiDirectory, fileName), 'utf8')
      return hardcodedQueryKeyUsages(source).map((snippet) => `${fileName}: ${snippet}`)
    })

    expect(violations).toEqual([])
  })
})

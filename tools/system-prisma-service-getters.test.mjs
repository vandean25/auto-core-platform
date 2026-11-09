import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {
  GROWTH_ALLOWLISTS,
  checkAllowlistGrowth,
  extractSystemPrismaDelegates,
} from './allowlist-growth-lib.mjs'
import { extractSystemPrismaGetters } from './system-prisma-service-getters.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const SERVICE_FILE = path.join(REPO_ROOT, 'apps/core-api/src/prisma/system-prisma.service.ts')
const TYPES_FILE = path.join(REPO_ROOT, 'apps/core-api/src/prisma/system-prisma.types.ts')

const getterEntry = GROWTH_ALLOWLISTS.find((row) => row.id === 'system-prisma-service-getters')

const stubClass = `export class SystemPrismaService {
  get tenant() { return null }
}
`

describe('extractSystemPrismaGetters', () => {
  const growthCases = [
    {
      name: 'public get',
      head: `export class SystemPrismaService {
  get tenant() { return null }
  public get customer() { return null }
}
`,
      growth: ['customer'],
    },
    {
      name: 'property member',
      head: `export class SystemPrismaService {
  get tenant() { return null }
  readonly customer = this.prisma.customer
}
`,
      growth: ['customer'],
    },
  ]

  for (const scenario of growthCases) {
    it(`detects growth: ${scenario.name}`, () => {
      const [result] = checkAllowlistGrowth({
        allowlists: [getterEntry],
        readBase: () => stubClass,
        readHead: () => scenario.head,
      })
      assert.equal(result.status, 'grew', scenario.name)
      assert.deepEqual(result.growth, scenario.growth)
    })
  }

  it('fail-closed on computed accessor name', () => {
    const head = `export class SystemPrismaService {
  get tenant() { return null }
  get ['customer']() { return null }
}
`
    assert.equal(extractSystemPrismaGetters(head), null)
  })

  it('matches the committed system-prisma.service.ts member inventory', () => {
    const members = extractSystemPrismaGetters(fs.readFileSync(SERVICE_FILE, 'utf8'))
    assert.deepEqual(members?.length, 29)
    assert.ok(members?.includes('tenant'))
    assert.ok(members?.includes('$transaction'))
  })
})

describe('extractSystemPrismaDelegates parity', () => {
  it('matches the committed system-prisma.types.ts delegate list', () => {
    const delegates = extractSystemPrismaDelegates(fs.readFileSync(TYPES_FILE, 'utf8'))
    assert.deepEqual(delegates?.length, 21)
    assert.ok(delegates?.includes('scheduledJobRun'))
  })
})

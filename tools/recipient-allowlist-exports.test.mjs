import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { extractRecipientAllowlistExports } from './recipient-allowlist-exports.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const RECIPIENT_FILE = path.join(REPO_ROOT, 'apps/core-api/src/notifications/email/recipient-allowlist.ts')

describe('extractRecipientAllowlistExports', () => {
  const cases = [
    ['export function f() {}', ['f']],
    ['export async function g() {}', ['g']],
    ['export const a = 1, b = 2', ['a', 'b']],
    ['export type { T } from "./types"', ['T', 'export*from:./types']],
    ['export abstract class X {}', ['X']],
    ['export function* gen() {}', ['gen']],
    ['export * from "./extra"', ['export*from:./extra']],
  ]

  for (const [source, expected] of cases) {
    it(`collects exports in: ${source.split('\n')[0]}`, () => {
      assert.deepEqual(extractRecipientAllowlistExports(`${source}\n`), expected)
    })
  }

  it('matches the committed recipient-allowlist.ts exports', () => {
    const names = extractRecipientAllowlistExports(fs.readFileSync(RECIPIENT_FILE, 'utf8'))
    assert.deepEqual(names, [
      'findInvalidAllowlistEntries',
      'isRecipientAllowlisted',
      'parseRecipientAllowlist',
    ])
  })
})

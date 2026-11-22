import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const adrDirectory = new URL('../../docs/internal/01-ADR/', import.meta.url)
const accountingAdr = '2026-09-20-legal-invoicing-and-accounting-export.md'
const bankReconciliationAdr = '2026-11-18-bank-reconciliation.md'

function readAdr(fileName) {
  return readFileSync(new URL(fileName, adrDirectory), 'utf8')
}

function linksTo(markdown, fileName) {
  const links = markdown.matchAll(/\]\((?:\.\/)?([^\s)#]+)(?:#[^\s)]+)?\)/g)
  return Array.from(links).some(([, target]) => target === fileName)
}

test('the ADR index links to bank reconciliation in its ADR-0040 row', () => {
  const row = readAdr('README.md')
    .split(/\r?\n/)
    .find((line) => /^\|\s*ADR-0040\s*\|/.test(line))
  assert.ok(
    row && linksTo(row, bankReconciliationAdr),
    `README.md must link to ${bankReconciliationAdr} in the ADR-0040 row`,
  )
})

test('the accounting and bank reconciliation ADRs link to each other', () => {
  const directions = [
    [accountingAdr, bankReconciliationAdr],
    [bankReconciliationAdr, accountingAdr],
  ]
  for (const [source, target] of directions) {
    assert.ok(linksTo(readAdr(source), target), `${source} must link to ${target}`)
  }
})

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const checker = fileURLToPath(new URL('./docs-check.mjs', import.meta.url))
const uiFile = 'apps/core-web/src/pages/x/Foo.tsx'
const docsFile = 'docs-site/workflows/x.mdx'

function runCheck(files, body = '') {
  const directory = mkdtempSync(join(tmpdir(), 'acp-docs-check-'))
  const summaryPath = join(directory, 'summary.md')
  writeFileSync(summaryPath, '')
  try {
    const result = spawnSync(process.execPath, [checker], {
      input: `${files.join('\0')}\0`,
      encoding: 'utf8',
      env: { ...process.env, PR_BODY: body, GITHUB_STEP_SUMMARY: summaryPath },
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr)
    return { log: result.stdout, summary: readFileSync(summaryPath, 'utf8') }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('warns about an undocumented UI change and exits successfully', () => {
  const { log, summary } = runCheck([uiFile, 'apps/core-api/src/main.ts'])

  assert.match(log, /^::warning::.*Foo\.tsx.*or ask ACP Doku/m)
  assert.ok(summary.includes(uiFile))
  assert.ok(!summary.includes('apps/core-api/src/main.ts'))
  assert.match(summary, /or ask ACP Doku/)
})

test('stays quiet when the PR updates the docs', () => {
  assert.deepEqual(runCheck([uiFile, docsFile]), { log: '', summary: '' })
})

test('accepts a Docs opt-out only when it has a reason on the same line', () => {
  assert.equal(runCheck([uiFile], '## Summary\r\nDocs: n/a – internal refactor\r\n').log, '')
  for (const body of [
    'Docs: n/a – \r\n## Tests',
    '<!--\nDocs: n/a – internal refactor\n-->',
    'Docs: n/a – <reason>',
  ]) {
    assert.match(runCheck([uiFile], body).log, /^::warning::/)
  }
})

test('warns when the generated OpenAPI contract changes without docs', () => {
  assert.match(runCheck(['apps/core-api/openapi/openapi.json']).log, /^::warning::.*openapi\.json/)
})

test('stays quiet when only tests, backend internals or CI files change', () => {
  const result = runCheck([
    'apps/core-web/src/pages/x/Foo.test.tsx',
    'apps/core-web/src/pages/x/Foo.spec.tsx',
    'apps/core-web/src/pages/x/__tests__/Fixture.tsx',
    'apps/core-web/src/test/Fixture.tsx',
    'apps/core-api/src/main.ts',
    '.github/workflows/build.yaml',
  ])
  assert.deepEqual(result, { log: '', summary: '' })
})

test('counts German and English locale changes as user-facing', () => {
  const files = ['locales/de/common.json', 'locales/en/common.json']
  const { summary } = runCheck(files)

  for (const file of files) assert.ok(summary.includes(file))
})

test('stays quiet on a docs-only PR', () => {
  assert.deepEqual(runCheck([docsFile]), { log: '', summary: '' })
})

test('the workflow forwards the PR body only through the checker step environment', () => {
  const workflow = readFileSync(new URL('../workflows/pr-hints.yaml', import.meta.url), 'utf8')
  const body = /\$\{\{[^}\r\n]*\bgithub\.event\.pull_request\.body\b[^}\r\n]*\}\}/g

  assert.equal([...workflow.matchAll(body)].length, 1)
  assert.match(workflow, /\n        env:\r?\n          PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}\r?\n        run: .*node \.github\/scripts\/docs-check\.mjs/)
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  classifyChangedFiles,
  evaluateBaseRunResults,
  isBugLabeled,
  parseGitNameStatus,
  parseRegressionTestNa,
  parseRunnerJsonReport,
  runAtBase,
  runPreflight,
} from './bug-regression-at-base.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Helper to create a temporary git repository with a base commit and a head commit.
 *
 * @param {Record<string, string>} baseFiles
 * @param {Record<string, string>} headFiles
 */
function createFixtureRepo(baseFiles, headFiles) {
  const dir = mkdtempSync(path.join(tmpdir(), 'bug-reg-fixture-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()

  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test User')

  for (const [rel, content] of Object.entries(baseFiles)) {
    const full = path.join(dir, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf8')
  }
  git('add', '.')
  git('commit', '-m', 'base')
  const baseSha = git('rev-parse', 'HEAD')

  git('checkout', '-b', 'feature/bugfix')
  for (const [rel, content] of Object.entries(headFiles)) {
    const full = path.join(dir, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content, 'utf8')
  }
  git('add', '.')
  git('commit', '-m', 'fix bug and add regression test')
  const headSha = git('rev-parse', 'HEAD')

  return { dir, baseSha, headSha, git }
}

test('WHEN a Bug PR adds a test that fails on the base and passes on head THEN the job passes and lists the test', () => {
  const { dir, baseSha, headSha, git } = createFixtureRepo(
    {
      'apps/core-api/src/math.mjs': 'export function add(a, b) { return a - b; }\n',
    },
    {
      'apps/core-api/src/math.mjs': 'export function add(a, b) { return a + b; }\n',
      'apps/core-api/src/math.spec.ts': 'regression test placeholder\n',
      'apps/core-api/test/helpers/math.fixture.ts': 'export const pair = [2, 3];\n',
    },
  )

  const summaryFile = path.join(dir, 'summary.md')
  try {
    git('checkout', '--detach', baseSha)

    const result = runAtBase({
      cwd: dir,
      mergeBase: baseSha,
      headSha,
      summaryFile,
      customSuites: [
        {
          suite: 'backend-unit',
          run: (reportPath) => {
            // Confirm production file on base was NOT overwritten by head
            const prodCode = readFileSync(path.join(dir, 'apps/core-api/src/math.mjs'), 'utf8')
            assert.match(prodCode, /return a - b/)
            // Confirm test and helper WERE overlaid from head
            assert.match(
              readFileSync(path.join(dir, 'apps/core-api/src/math.spec.ts'), 'utf8'),
              /regression test placeholder/,
            )
            assert.match(
              readFileSync(path.join(dir, 'apps/core-api/test/helpers/math.fixture.ts'), 'utf8'),
              /pair = \[2, 3\]/,
            )

            writeFileSync(
              reportPath,
              JSON.stringify({
                testResults: [
                  {
                    name: 'apps/core-api/src/math.spec.ts',
                    status: 'failed',
                    assertionResults: [
                      {
                        ancestorTitles: ['add'],
                        title: 'adds two positive numbers',
                        status: 'failed',
                      },
                    ],
                  },
                ],
              }),
            )
            return 1
          },
        },
      ],
    })

    assert.equal(result.ok, true)
    assert.equal(result.reason, 'failed-on-base-as-expected')
    assert.equal(result.failedTests.length, 1)
    assert.equal(result.failedTests[0].name, 'add > adds two positive numbers')

    const summary = readFileSync(summaryFile, 'utf8')
    assert.match(summary, /Bug Regression at Base — Passed/)
    assert.match(summary, /add > adds two positive numbers/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WHEN a Bug PR new test passes on the base THEN the job fails (anti-criterion)', () => {
  const { dir, baseSha, headSha, git } = createFixtureRepo(
    {
      'apps/core-api/src/ok.mjs': 'export const ok = true;\n',
    },
    {
      'apps/core-api/src/ok.spec.ts': 'passing test on base\n',
    },
  )

  const summaryFile = path.join(dir, 'summary.md')
  try {
    git('checkout', '--detach', baseSha)

    const result = runAtBase({
      cwd: dir,
      mergeBase: baseSha,
      headSha,
      summaryFile,
      customSuites: [
        {
          suite: 'backend-unit',
          run: (reportPath) => {
            writeFileSync(
              reportPath,
              JSON.stringify({
                testResults: [
                  {
                    name: 'apps/core-api/src/ok.spec.ts',
                    status: 'passed',
                    assertionResults: [
                      {
                        ancestorTitles: ['ok'],
                        title: 'is already true on base',
                        status: 'passed',
                      },
                    ],
                  },
                ],
              }),
            )
            return 0
          },
        },
      ],
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'tests-passed-on-base')
    const summary = readFileSync(summaryFile, 'utf8')
    assert.match(summary, /Bug Regression at Base — Failed/)
    assert.match(summary, /PASSED on the base branch/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WHEN a Bug PR has no new or changed test and no n/a line THEN the job fails', () => {
  const { dir, baseSha, headSha } = createFixtureRepo(
    { 'apps/core-api/src/service.ts': 'export const a = 1;\n' },
    { 'apps/core-api/src/service.ts': 'export const a = 2;\n' },
  )

  const summaryFile = path.join(dir, 'summary.md')
  const outputFile = path.join(dir, 'output.txt')
  try {
    const noNa = runPreflight({
      cwd: dir,
      baseRef: baseSha,
      headSha,
      prBody: 'Fixes a bug without any test.',
      labels: [{ name: 'bug' }],
      outputFile,
      summaryFile,
    })

    assert.equal(noNa.ok, false)
    assert.equal(noNa.decision, 'fail')
    assert.match(noNa.reason, /no new or changed test files/i)

    const naWithoutReason = runPreflight({
      cwd: dir,
      baseRef: baseSha,
      headSha,
      prBody: 'regression-test: n/a',
      labels: [{ name: 'bug' }],
      outputFile,
      summaryFile,
    })

    assert.equal(naWithoutReason.ok, false)
    assert.equal(naWithoutReason.decision, 'fail')
    assert.match(naWithoutReason.reason, /without a reason/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WHEN a Bug PR has a regression-test: n/a line with a reason THEN the job is neutral and shows the reason', () => {
  const { dir, baseSha, headSha } = createFixtureRepo(
    { 'infra/main.tf': '# base\n' },
    { 'infra/main.tf': '# updated config\n' },
  )

  const summaryFile = path.join(dir, 'summary.md')
  const outputFile = path.join(dir, 'output.txt')
  try {
    const result = runPreflight({
      cwd: dir,
      baseRef: baseSha,
      headSha,
      prBody: 'Fixes Cloud Run timeout.\n\nregression-test: n/a — Terraform config-only fix',
      labels: [{ name: 'bug' }],
      outputFile,
      summaryFile,
    })

    assert.equal(result.ok, true)
    assert.equal(result.decision, 'neutral')
    assert.equal(result.reason, 'Terraform config-only fix')

    const output = readFileSync(outputFile, 'utf8')
    assert.match(output, /decision=neutral/)
    assert.match(output, /reason=Terraform config-only fix/)

    const summary = readFileSync(summaryFile, 'utf8')
    assert.match(summary, /Neutral/)
    assert.match(summary, /Terraform config-only fix/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WHEN the PR is not labeled Bug THEN the job does not run', () => {
  assert.equal(isBugLabeled(['enhancement', 'documentation']), false)
  assert.equal(isBugLabeled([{ name: 'chore' }]), false)
  assert.equal(isBugLabeled(['bug']), true)
  assert.equal(isBugLabeled([{ name: 'Bug' }]), true)

  const workflow = readFileSync(
    path.join(REPO_ROOT, '.github/workflows/bug-regression-at-base.yaml'),
    'utf8',
  )
  assert.match(
    workflow,
    /if:\s*contains\(github\.event\.pull_request\.labels\.\*\.name,\s*'bug'\)\s*\|\|\s*contains\(github\.event\.pull_request\.labels\.\*\.name,\s*'Bug'\)/,
  )
  assert.match(workflow, /needs:\s*\[preflight\]/)
  assert.match(workflow, /if:\s*needs\.preflight\.outputs\.decision\s*==\s*'run'/)
})

test('Anti-criterion: the job never skips the full e2e suite or marks it optional', () => {
  const buildWorkflow = readFileSync(
    path.join(REPO_ROOT, '.github/workflows/build.yaml'),
    'utf8',
  )
  assert.match(buildWorkflow, /needs:\s*\[backend,\s*backend-unit,\s*backend-e2e,\s*pdf-worker-image\]/)
  assert.match(buildWorkflow, /needs:\s*\[frontend-unit,\s*frontend-e2e\]/)
})

test('classifyChangedFiles excludes production source files and classifies test suites + helpers', () => {
  const diff = [
    'M\tapps/core-api/src/sales/invoice.service.ts',
    'M\tapps/core-api/src/sales/invoice.service.spec.ts',
    'A\tapps/core-api/test/invoice-tax.e2e-spec.ts',
    'A\tapps/core-api/test/helpers/invoice.helper.ts',
    'M\tapps/core-web/src/pages/InvoicePage.tsx',
    'A\tapps/core-web/src/pages/InvoicePage.test.tsx',
    'A\tapps/core-web/e2e/invoice.spec.ts',
  ].join('\n')

  const classified = classifyChangedFiles(parseGitNameStatus(diff))
  assert.deepEqual(classified.backendUnit, ['apps/core-api/src/sales/invoice.service.spec.ts'])
  assert.deepEqual(classified.backendE2e, ['apps/core-api/test/invoice-tax.e2e-spec.ts'])
  assert.deepEqual(classified.frontendUnit, ['apps/core-web/src/pages/InvoicePage.test.tsx'])
  assert.deepEqual(classified.frontendE2e, ['apps/core-web/e2e/invoice.spec.ts'])
  assert.deepEqual(classified.helpers, ['apps/core-api/test/helpers/invoice.helper.ts'])
  assert.equal(classified.filesToCopy.includes('apps/core-api/src/sales/invoice.service.ts'), false)
  assert.equal(classified.filesToCopy.includes('apps/core-web/src/pages/InvoicePage.tsx'), false)
})

test('parseRunnerJsonReport handles Playwright JSON and evaluateBaseRunResults catches runner errors', () => {
  const pw = parseRunnerJsonReport(
    'frontend-e2e',
    JSON.stringify({
      suites: [
        {
          title: 'Invoice',
          file: 'e2e/invoice.spec.ts',
          specs: [
            {
              title: 'shows credit note',
              tests: [{ status: 'unexpected', results: [{ status: 'failed' }] }],
            },
          ],
        },
      ],
    }),
  )
  assert.equal(pw.failedTests.length, 1)
  assert.equal(pw.failedTests[0].name, 'Invoice > shows credit note')

  const missingReport = evaluateBaseRunResults([
    { suite: 'backend-unit', exitCode: 1, reportPath: '/nonexistent/report.json' },
  ])
  assert.equal(missingReport.ok, false)
  assert.equal(missingReport.reason, 'runner-error')

  const naParsed = parseRegressionTestNa('regression-test: n/a: doc typo')
  assert.equal(naParsed.isNa, true)
  assert.equal(naParsed.reason, 'doc typo')
})

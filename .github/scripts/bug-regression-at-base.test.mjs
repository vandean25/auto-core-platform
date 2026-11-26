import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  buildSuiteSpecs,
  classifyChangedFiles,
  evaluateBaseRunResults,
  isBugLabeled,
  isProductFixTitle,
  parseGitNameStatus,
  parseRegressionEvidence,
  parseRegressionTestNa,
  parseRunnerJsonReport,
  runAtBase,
  runPreflight,
  shouldRunRegressionCheck,
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
    /contains\(github\.event\.pull_request\.labels\.\*\.name,\s*'bug'\)[\s\S]*contains\(github\.event\.pull_request\.labels\.\*\.name,\s*'Bug'\)/,
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
  assert.match(buildWorkflow, /npm run bug-regression-at-base:test/)
})

test('classifyChangedFiles excludes production source files and classifies test suites + helpers', () => {
  const diff = [
    'M\tapps/core-api/src/sales/invoice.service.ts',
    'M\tapps/core-api/src/sales/invoice.service.spec.ts',
    'A\tapps/core-api/test/invoice-tax.e2e-spec.ts',
    'A\tapps/core-api/test/helpers/invoice.helper.ts',
    'A\tapps/core-api/test/support/seed.ts',
    'M\tapps/core-api/test/jest-esm-setup.ts',
    'M\tapps/core-web/src/pages/InvoicePage.tsx',
    'A\tapps/core-web/src/pages/InvoicePage.test.tsx',
    'A\tapps/core-web/e2e/invoice.spec.ts',
  ].join('\n')

  const classified = classifyChangedFiles(parseGitNameStatus(diff))
  assert.deepEqual(classified.backendUnit, ['apps/core-api/src/sales/invoice.service.spec.ts'])
  assert.deepEqual(classified.backendE2e, ['apps/core-api/test/invoice-tax.e2e-spec.ts'])
  assert.deepEqual(classified.frontendUnit, ['apps/core-web/src/pages/InvoicePage.test.tsx'])
  assert.deepEqual(classified.frontendE2e, ['apps/core-web/e2e/invoice.spec.ts'])
  assert.deepEqual(classified.helpers, [
    'apps/core-api/test/helpers/invoice.helper.ts',
    'apps/core-api/test/support/seed.ts',
    'apps/core-api/test/jest-esm-setup.ts',
  ])
  assert.equal(classified.filesToCopy.includes('apps/core-api/src/sales/invoice.service.ts'), false)
  assert.equal(classified.filesToCopy.includes('apps/core-web/src/pages/InvoicePage.tsx'), false)
})

test('buildSuiteSpecs prepares both build:e2e and build:pwa and runs all Playwright projects', () => {
  const calls = []
  const fakeExec = (cmd, args, _cwd, env) => {
    calls.push({ cmd, args, env })
    return 0
  }

  const classified = classifyChangedFiles(
    parseGitNameStatus('A\tapps/core-web/e2e/login.spec.ts\nA\tapps/core-web/e2e/visual/home.visual.spec.ts'),
  )
  const specs = buildSuiteSpecs('/repo', classified, '/tmp/reports', fakeExec)
  assert.equal(specs.length, 1)
  assert.equal(specs[0].suite, 'frontend-e2e')

  assert.equal(specs[0].prepare(), 0)
  assert.equal(specs[0].run('/tmp/reports/frontend-e2e.json'), 0)

  assert.deepEqual(calls[0], {
    cmd: 'npm',
    args: ['run', 'build:e2e', '--workspace=core-web'],
    env: undefined,
  })
  assert.deepEqual(calls[1], {
    cmd: 'npm',
    args: ['run', 'build:pwa', '--workspace=core-web'],
    env: undefined,
  })
  assert.equal(calls[2].cmd, 'npx')
  assert.deepEqual(calls[2].args, [
    '--workspace=core-web',
    'playwright',
    'test',
    '--project=chromium',
    '--project=chromium-dev-server',
    '--project=chromium-pwa',
    '--project=visual',
    '--reporter=json',
    'e2e/login.spec.ts',
    'e2e/visual/home.visual.spec.ts',
  ])
  assert.equal(calls[2].env.PLAYWRIGHT_JSON_OUTPUT_NAME, '/tmp/reports/frontend-e2e.json')
})

test('evaluateBaseRunResults rejects suite-level load errors without assertion failures', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bug-reg-suite-err-'))
  try {
    const reportPath = path.join(dir, 'jest.json')
    writeFileSync(
      reportPath,
      JSON.stringify({
        testResults: [
          {
            name: 'apps/core-api/src/missing-symbol.spec.ts',
            status: 'failed',
            message: 'Cannot find module ./new-helper',
            assertionResults: [],
          },
        ],
      }),
    )
    const result = evaluateBaseRunResults([{ suite: 'backend-unit', exitCode: 1, reportPath }])
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'suite-load-error')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
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

test('title matching triggers on product fix( PRs and excludes fix(ci|docs|deps|chore)', () => {
  assert.equal(isProductFixTitle('fix(workshop): prevent duplicate invoice'), true)
  assert.equal(isProductFixTitle('fix(domain-events): emit event after commit'), true)
  assert.equal(isProductFixTitle('fix(ci): update cache key'), false)
  assert.equal(isProductFixTitle('fix(docs): fix typo in readme'), false)
  assert.equal(isProductFixTitle('fix(deps): bump vitest'), false)
  assert.equal(isProductFixTitle('fix(chore): remove dead script'), false)
  assert.equal(isProductFixTitle('fix(circle): fix radius'), true)
  assert.equal(isProductFixTitle('fix(ci-cache): invalidate key'), true)
  assert.equal(isProductFixTitle('fix(documentation): fix link'), true)
  assert.equal(isProductFixTitle('fix(dependencies): pin version'), true)
  assert.equal(isProductFixTitle('fix(chores): fix assignment'), true)
  assert.equal(isProductFixTitle('feat(workshop): add column'), false)
  assert.equal(isProductFixTitle('fix: missing scope'), false)
  assert.equal(isProductFixTitle(undefined), false)

  assert.equal(shouldRunRegressionCheck({ labels: [], title: 'fix(workshop): prevent crash' }), true)
  assert.equal(shouldRunRegressionCheck({ labels: [], title: 'fix(circle): fix radius' }), true)
  assert.equal(shouldRunRegressionCheck({ labels: [], title: 'fix(ci): tweak workflow' }), false)
  assert.equal(shouldRunRegressionCheck({ labels: ['bug'], title: 'fix(ci): tweak workflow' }), true)
  assert.equal(shouldRunRegressionCheck({ labels: [], title: 'feat(workshop): new feature' }), false)

  const workflow = readFileSync(
    path.join(REPO_ROOT, '.github/workflows/bug-regression-at-base.yaml'),
    'utf8',
  )
  assert.match(workflow, /startsWith\(github\.event\.pull_request\.title,\s*'fix\('\)/)
  assert.match(workflow, /!startsWith\(github\.event\.pull_request\.title,\s*'fix\(ci\)'\)/)
  assert.match(workflow, /!startsWith\(github\.event\.pull_request\.title,\s*'fix\(docs\)'\)/)
  assert.match(workflow, /!startsWith\(github\.event\.pull_request\.title,\s*'fix\(deps\)'\)/)
  assert.match(workflow, /!startsWith\(github\.event\.pull_request\.title,\s*'fix\(chore\)'\)/)
  assert.match(workflow, /PR_TITLE:\s*\$\{\{\s*github\.event\.pull_request\.title\s*\}\}/)
})

test('WHEN a PR titled fix(workshop): ... without label adds a test THEN preflight runs', () => {
  const { dir, baseSha, headSha } = createFixtureRepo(
    { 'apps/core-api/src/workshop.service.ts': 'export const a = 1;\n' },
    {
      'apps/core-api/src/workshop.service.ts': 'export const a = 2;\n',
      'apps/core-api/src/workshop.service.spec.ts': 'it("catches regression", () => {})\n',
    },
  )

  const summaryFile = path.join(dir, 'summary.md')
  const outputFile = path.join(dir, 'output.txt')
  try {
    const result = runPreflight({
      cwd: dir,
      baseRef: baseSha,
      headSha,
      prBody: 'Fixes workshop crash.\n\nFAIL apps/core-api/src/workshop.service.spec.ts',
      labels: [],
      title: 'fix(workshop): avoid crash',
      outputFile,
      summaryFile,
    })

    assert.equal(result.ok, true)
    assert.equal(result.decision, 'run')
    assert.equal(result.evidence?.kind, 'fail-output')
    const output = readFileSync(outputFile, 'utf8')
    assert.match(output, /decision=run/)
    assert.match(output, /evidence=fail-output/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WHEN a fix(ci): ... PR opens without bug label THEN preflight skips', () => {
  const { dir, baseSha, headSha } = createFixtureRepo(
    { '.github/workflows/build.yaml': 'name: build\n' },
    { '.github/workflows/build.yaml': 'name: build v2\n' },
  )

  const summaryFile = path.join(dir, 'summary.md')
  const outputFile = path.join(dir, 'output.txt')
  try {
    const result = runPreflight({
      cwd: dir,
      baseRef: baseSha,
      headSha,
      prBody: 'Tweak CI caching.',
      labels: [],
      title: 'fix(ci): tweak workflow',
      outputFile,
      summaryFile,
    })

    assert.equal(result.ok, true)
    assert.equal(result.decision, 'skip')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WHEN a fix PR has no new test and no escape line THEN preflight fails with a clear message', () => {
  const { dir, baseSha, headSha } = createFixtureRepo(
    { 'apps/core-api/src/workshop.service.ts': 'export const a = 1;\n' },
    { 'apps/core-api/src/workshop.service.ts': 'export const a = 2;\n' },
  )

  const summaryFile = path.join(dir, 'summary.md')
  const outputFile = path.join(dir, 'output.txt')
  try {
    const result = runPreflight({
      cwd: dir,
      baseRef: baseSha,
      headSha,
      prBody: 'Fixes workshop bug without test or escape.',
      labels: [],
      title: 'fix(workshop): avoid crash',
      outputFile,
      summaryFile,
    })

    assert.equal(result.ok, false)
    assert.equal(result.decision, 'fail')
    assert.match(result.reason, /no new or changed test files/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('parseRegressionEvidence detects fail output, base-run URL, and regression-test: n/a', () => {
  const na = parseRegressionEvidence('Summary\n\nregression-test: n/a — copy-only fix')
  assert.equal(na.hasEvidence, true)
  assert.equal(na.kind, 'na')
  assert.equal(na.detail, 'copy-only fix')

  const url = parseRegressionEvidence(
    'Base run: https://github.com/vandean25/auto-core-platform/actions/runs/987654321',
  )
  assert.equal(url.hasEvidence, true)
  assert.equal(url.kind, 'base-run-url')
  assert.match(url.detail, /actions\/runs\/987654321/)

  const jestFail = parseRegressionEvidence(
    '```text\nFAIL apps/core-api/src/sales/invoice.service.spec.ts\n  ● rejects duplicate\n```',
  )
  assert.equal(jestFail.hasEvidence, true)
  assert.equal(jestFail.kind, 'fail-output')

  const none = parseRegressionEvidence(
    '<!-- FAIL apps/core-api/src/ignored.spec.ts -->\nFixes a failed login state in the UI.',
  )
  assert.equal(none.hasEvidence, false)
  assert.equal(none.kind, 'none')
})


import { execFileSync, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const TEST_PATTERNS = {
  backendUnit: /^apps\/core-api\/src\/.*\.spec\.ts$/,
  backendE2e: /^apps\/core-api\/test\/.*\.e2e-spec\.ts$/,
  frontendUnit: /^apps\/core-web\/src\/.*\.(test|spec)\.(ts|tsx)$/,
  frontendE2e: /^apps\/core-web\/e2e\/.*\.spec\.ts$/,
}

const HELPER_PATTERNS = [
  /^apps\/core-api\/test\/helpers\//,
  /^apps\/core-api\/test\/fixtures\//,
  /^apps\/core-api\/src\/.*\/testing\//,
  /^apps\/core-api\/src\/.*\/__fixtures__\//,
  /^apps\/core-api\/src\/.*\.(fixture|test-helper)\.[^/]+$/,
  /^apps\/core-web\/src\/test\//,
  /^apps\/core-web\/src\/.*\/__fixtures__\//,
  /^apps\/core-web\/src\/.*\.(fixture|test-helper)\.[^/]+$/,
  /^apps\/core-web\/e2e\/utils\//,
  /^apps\/core-web\/e2e\/fixtures\//,
]

/**
 * Checks whether the PR labels include a Bug label (`bug` or `Bug`).
 *
 * @param {Array<string | { name?: string }>} labels
 * @returns {boolean}
 */
export function isBugLabeled(labels) {
  if (!Array.isArray(labels)) {
    return false
  }
  return labels.some((entry) => {
    const name = typeof entry === 'string' ? entry : entry?.name
    if (typeof name !== 'string') {
      return false
    }
    const normalized = name.trim().toLowerCase()
    return normalized === 'bug' || normalized === 'typ: bug' || normalized === 'type: bug'
  })
}

/**
 * Parses an explicit `regression-test: n/a` escape-hatch line with a reason from the PR body.
 *
 * @param {string | null | undefined} prBody
 * @returns {{ isNa: boolean, missingReason: boolean, reason: string }}
 */
export function parseRegressionTestNa(prBody) {
  if (!prBody || typeof prBody !== 'string') {
    return { isNa: false, missingReason: false, reason: '' }
  }

  for (const rawLine of prBody.split(/\r?\n/)) {
    const match = /^regression-test:\s*n\/a\b(.*)$/i.exec(rawLine.trim())
    if (!match) {
      continue
    }
    const reason = match[1].replace(/^[\s:—–-]+/, '').trim()
    if (reason.length === 0) {
      return { isNa: false, missingReason: true, reason: '' }
    }
    return { isNa: true, missingReason: false, reason }
  }

  return { isNa: false, missingReason: false, reason: '' }
}

/**
 * Parses `git diff --name-status --diff-filter=AMR` output.
 *
 * @param {string} diffOutput
 * @returns {Array<{ status: string, path: string }>}
 */
export function parseGitNameStatus(diffOutput) {
  if (!diffOutput || !diffOutput.trim()) {
    return []
  }
  const entries = []
  for (const rawLine of diffOutput.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }
    const parts = line.split('\t')
    const status = parts[0] ?? ''
    if (status.startsWith('R') && parts[2]) {
      entries.push({ status: 'R', path: parts[2] })
    } else if (parts[1]) {
      entries.push({ status: status[0], path: parts[1] })
    }
  }
  return entries
}

/**
 * Classifies changed files into test suites and allowed test helpers/fixtures.
 * Production source files are never included.
 *
 * @param {Array<{ status: string, path: string }>} entries
 */
export function classifyChangedFiles(entries) {
  /** @type {string[]} */
  const backendUnit = []
  /** @type {string[]} */
  const backendE2e = []
  /** @type {string[]} */
  const frontendUnit = []
  /** @type {string[]} */
  const frontendE2e = []
  /** @type {string[]} */
  const helpers = []

  for (const entry of entries) {
    const filePath = entry.path.replace(/\\/g, '/')
    if (TEST_PATTERNS.backendUnit.test(filePath)) {
      backendUnit.push(filePath)
    } else if (TEST_PATTERNS.backendE2e.test(filePath)) {
      backendE2e.push(filePath)
    } else if (TEST_PATTERNS.frontendUnit.test(filePath)) {
      frontendUnit.push(filePath)
    } else if (TEST_PATTERNS.frontendE2e.test(filePath)) {
      frontendE2e.push(filePath)
    } else if (HELPER_PATTERNS.some((pattern) => pattern.test(filePath))) {
      helpers.push(filePath)
    }
  }

  const allTests = [...backendUnit, ...backendE2e, ...frontendUnit, ...frontendE2e]
  const filesToCopy = [...new Set([...allTests, ...helpers])]

  return {
    backendUnit,
    backendE2e,
    frontendUnit,
    frontendE2e,
    helpers,
    allTests,
    filesToCopy,
  }
}

function formatAssertionName(assertion) {
  if (assertion.fullName) {
    return assertion.fullName
  }
  const joined = [...(assertion.ancestorTitles ?? []), assertion.title].filter(Boolean).join(' > ')
  return joined || 'unnamed test'
}

function parseJestOrVitestResults(suiteName, testResults) {
  const failedTests = []
  const failedSuites = []
  let passedCount = 0

  for (const fileResult of testResults) {
    const file = fileResult.name ?? 'unknown'
    const assertions = fileResult.assertionResults ?? []
    let fileHasFailure = false

    for (const assertion of assertions) {
      if (assertion.status === 'failed') {
        fileHasFailure = true
        failedTests.push({ suite: suiteName, file, name: formatAssertionName(assertion) })
      } else if (assertion.status === 'passed') {
        passedCount += 1
      }
    }

    if (fileResult.status === 'failed' && !fileHasFailure) {
      failedSuites.push({
        suite: suiteName,
        file,
        message: String(fileResult.message || 'Suite failed to load or compile on base').slice(0, 400),
      })
    }
  }

  return { failedTests, failedSuites, passedCount }
}

function isPlaywrightTestFailed(testEntry) {
  if (testEntry.status === 'unexpected') {
    return true
  }
  const results = testEntry.results ?? []
  const last = results[results.length - 1]
  return last?.status === 'failed' || last?.status === 'timedOut'
}

function isPlaywrightTestPassed(testEntry) {
  const results = testEntry.results ?? []
  const last = results[results.length - 1]
  return last?.status === 'passed'
}

function collectPlaywrightSuite(suiteName, suite, parents, out) {
  const nextParents = suite.title ? [...parents, suite.title] : parents
  for (const spec of suite.specs ?? []) {
    const specTitle = [...nextParents, spec.title].filter(Boolean).join(' > ') || 'unnamed spec'
    const file = spec.file ?? suite.file ?? 'unknown'
    for (const testEntry of spec.tests ?? []) {
      if (isPlaywrightTestFailed(testEntry)) {
        out.failedTests.push({ suite: suiteName, file, name: specTitle })
      } else if (isPlaywrightTestPassed(testEntry)) {
        out.passedCount += 1
      }
    }
  }
  for (const child of suite.suites ?? []) {
    collectPlaywrightSuite(suiteName, child, nextParents, out)
  }
}

/**
 * Extracts failing test names and suite errors from Jest / Vitest / Playwright JSON output.
 *
 * @param {string} suiteName
 * @param {string} rawJson
 */
export function parseRunnerJsonReport(suiteName, rawJson) {
  const data = JSON.parse(rawJson)
  if (Array.isArray(data.testResults)) {
    return parseJestOrVitestResults(suiteName, data.testResults)
  }
  if (Array.isArray(data.suites)) {
    const out = { failedTests: [], failedSuites: [], passedCount: 0 }
    for (const rootSuite of data.suites) {
      collectPlaywrightSuite(suiteName, rootSuite, [], out)
    }
    return out
  }
  return { failedTests: [], failedSuites: [], passedCount: 0 }
}

function readSingleSuiteRun(run) {
  if (!run.reportPath || !existsSync(run.reportPath)) {
    return { error: `${run.suite}: missing JSON test report (exit code ${run.exitCode})` }
  }
  try {
    const parsed = parseRunnerJsonReport(run.suite, readFileSync(run.reportPath, 'utf8'))
    const emptyFailure =
      run.exitCode !== 0 && parsed.failedTests.length === 0 && parsed.failedSuites.length === 0
    return {
      parsed,
      error: emptyFailure
        ? `${run.suite}: exited with ${run.exitCode} without any failing test or suite in report`
        : null,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { error: `${run.suite}: failed to parse test report (${msg})` }
  }
}

/**
 * Evaluates all executed base-branch suites and decides whether the regression check passes.
 * The check passes ONLY when at least one test (or suite) fails on the base branch.
 *
 * @param {Array<{ suite: string, exitCode: number, reportPath: string | null }>} suiteRuns
 */
export function evaluateBaseRunResults(suiteRuns) {
  const failedTests = []
  const failedSuites = []
  const runnerErrors = []
  let totalPassed = 0

  for (const run of suiteRuns) {
    const entry = readSingleSuiteRun(run)
    if (entry.error) {
      runnerErrors.push(entry.error)
    }
    if (entry.parsed) {
      failedTests.push(...entry.parsed.failedTests)
      failedSuites.push(...entry.parsed.failedSuites)
      totalPassed += entry.parsed.passedCount
    }
  }

  const hasFailures = failedTests.length > 0 || failedSuites.length > 0
  if (!hasFailures && runnerErrors.length > 0) {
    return { ok: false, reason: 'runner-error', failedTests, failedSuites, totalPassed, runnerErrors }
  }
  if (!hasFailures) {
    return { ok: false, reason: 'tests-passed-on-base', failedTests, failedSuites, totalPassed, runnerErrors }
  }
  return { ok: true, reason: 'failed-on-base-as-expected', failedTests, failedSuites, totalPassed, runnerErrors }
}

function writeGithubOutput(key, value, outputFile = process.env.GITHUB_OUTPUT) {
  if (!outputFile) {
    return
  }
  appendFileSync(outputFile, `${key}=${String(value).replace(/\r?\n/g, ' ')}\n`, 'utf8')
}

function writeGithubSummary(lines, summaryFile = process.env.GITHUB_STEP_SUMMARY) {
  if (!summaryFile) {
    return
  }
  appendFileSync(summaryFile, `${lines.join('\n')}\n`, 'utf8')
}

/**
 * Runs preflight checks for a Bug-labeled PR.
 *
 * @param {{
 *   cwd: string,
 *   baseRef: string,
 *   headSha: string,
 *   prBody: string,
 *   labels?: Array<string | { name?: string }>,
 *   outputFile?: string,
 *   summaryFile?: string,
 * }} options
 */
export function runPreflight(options) {
  const { cwd, baseRef, headSha, prBody, labels, outputFile, summaryFile } = options

  if (labels && !isBugLabeled(labels)) {
    writeGithubOutput('decision', 'skip', outputFile)
    writeGithubSummary(['## Bug Regression at Base', '', 'Skipped: PR is not labeled `bug`.'], summaryFile)
    return { ok: true, decision: 'skip', reason: 'not-bug-labeled' }
  }

  const na = parseRegressionTestNa(prBody)
  if (na.isNa) {
    writeGithubOutput('decision', 'neutral', outputFile)
    writeGithubOutput('reason', na.reason, outputFile)
    writeGithubSummary(
      ['## Bug Regression at Base — Neutral (`regression-test: n/a`)', '', `Reason: ${na.reason}`],
      summaryFile,
    )
    return { ok: true, decision: 'neutral', reason: na.reason }
  }

  const mergeBase = execFileSync('git', ['merge-base', headSha, baseRef], { cwd, encoding: 'utf8' }).trim()
  const diffOut = execFileSync(
    'git',
    ['diff', '--name-status', '--diff-filter=AMR', mergeBase, headSha],
    { cwd, encoding: 'utf8' },
  )
  const classified = classifyChangedFiles(parseGitNameStatus(diffOut))

  if (classified.allTests.length === 0) {
    const message = na.missingReason
      ? 'Bug PR has `regression-test: n/a` without a reason. Add a reason (e.g. `regression-test: n/a — config-only fix`) or add a failing regression test.'
      : 'Bug PR has no new or changed test files (`*.spec.ts`, `*.e2e-spec.ts`, `*.test.ts`, `*.test.tsx`) and no `regression-test: n/a — <reason>` line in the PR body.'
    writeGithubOutput('decision', 'fail', outputFile)
    writeGithubSummary(['## Bug Regression at Base — Failed', '', message], summaryFile)
    return { ok: false, decision: 'fail', reason: message }
  }

  writeGithubOutput('decision', 'run', outputFile)
  writeGithubOutput('merge_base', mergeBase, outputFile)
  writeGithubOutput('head_sha', headSha, outputFile)
  return { ok: true, decision: 'run', mergeBase, headSha, classified }
}

/**
 * Copies ONLY the classified test and helper files from `headSha` into `cwd` (checked out at `mergeBase`).
 *
 * @param {string} cwd
 * @param {string} headSha
 * @param {string[]} filesToCopy
 */
export function overlayTestFilesFromHead(cwd, headSha, filesToCopy) {
  for (const relPath of filesToCopy) {
    const content = execFileSync('git', ['show', `${headSha}:${relPath}`], {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
    })
    const target = path.join(cwd, relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

function runCommand(cmd, args, cwd, env = process.env) {
  return spawnSync(cmd, args, { cwd, env, stdio: 'inherit' }).status ?? 1
}

function buildSuiteSpecs(cwd, classified, reportDir) {
  const suites = []
  if (classified.backendUnit.length > 0) {
    const rel = classified.backendUnit.map((f) => f.replace(/^apps\/core-api\//, ''))
    suites.push({
      suite: 'backend-unit',
      reportPath: path.join(reportDir, 'backend-unit.json'),
      run: (rp) =>
        runCommand('npm', ['test', '--workspace=core-api', '--', '--ci', '--runInBand', '--json', `--outputFile=${rp}`, ...rel], cwd),
    })
  }
  if (classified.frontendUnit.length > 0) {
    const rel = classified.frontendUnit.map((f) => f.replace(/^apps\/core-web\//, ''))
    suites.push({
      suite: 'frontend-unit',
      reportPath: path.join(reportDir, 'frontend-unit.json'),
      run: (rp) =>
        runCommand('npx', ['--workspace=core-web', 'vitest', 'run', '--reporter=json', `--outputFile=${rp}`, ...rel], cwd),
    })
  }
  if (classified.backendE2e.length > 0) {
    const rel = classified.backendE2e.map((f) => f.replace(/^apps\/core-api\//, ''))
    suites.push({
      suite: 'backend-e2e',
      reportPath: path.join(reportDir, 'backend-e2e.json'),
      prepare: () => runCommand('npm', ['exec', '--workspace=core-api', '--', 'prisma', 'migrate', 'deploy'], cwd),
      run: (rp) =>
        runCommand('npm', ['run', 'test:e2e', '--workspace=core-api', '--', '--ci', '--runInBand', '--json', `--outputFile=${rp}`, ...rel], cwd),
    })
  }
  if (classified.frontendE2e.length > 0) {
    const rel = classified.frontendE2e.map((f) => f.replace(/^apps\/core-web\//, ''))
    suites.push({
      suite: 'frontend-e2e',
      reportPath: path.join(reportDir, 'frontend-e2e.json'),
      prepare: () => runCommand('npm', ['run', 'build:e2e', '--workspace=core-web'], cwd),
      run: (rp) =>
        runCommand('npx', ['--workspace=core-web', 'playwright', 'test', '--project=chromium', '--reporter=json', ...rel], cwd, {
          ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_NAME: rp,
        }),
    })
  }
  return suites
}

function writeBaseRunSummary(evaluation, summaryFile) {
  if (evaluation.ok) {
    const lines = [
      '## Bug Regression at Base — Passed',
      '',
      'The PR regression tests failed on the base branch as expected:',
      '',
      ...evaluation.failedTests.map((t) => `- \`[${t.suite}]\` **${t.name}** (\`${t.file}\`)`),
      ...evaluation.failedSuites.map((s) => `- \`[${s.suite}]\` Suite error in \`${s.file}\`: ${s.message}`),
    ]
    writeGithubSummary(lines, summaryFile)
    return
  }
  if (evaluation.reason === 'tests-passed-on-base') {
    writeGithubSummary(
      [
        '## Bug Regression at Base — Failed',
        '',
        `All ${evaluation.totalPassed} test(s) PASSED on the base branch.`,
        'A bug-fix regression test must fail on the base branch before the fix.',
      ],
      summaryFile,
    )
    return
  }
  writeGithubSummary(
    ['## Bug Regression at Base — Failed (Runner Error)', '', ...evaluation.runnerErrors.map((e) => `- ${e}`)],
    summaryFile,
  )
}

/**
 * Executes the base-branch regression verification:
 * overlays ONLY test/helper files from `headSha` onto `cwd` (at `mergeBase`),
 * runs unit/API tests first and e2e where needed, and passes only if tests fail.
 *
 * @param {{
 *   cwd: string,
 *   mergeBase: string,
 *   headSha: string,
 *   summaryFile?: string,
 *   customSuites?: Array<{ suite: string, run: (reportPath: string) => number }>,
 * }} options
 */
export function runAtBase(options) {
  const { cwd, mergeBase, headSha, summaryFile, customSuites } = options
  const diffOut = execFileSync(
    'git',
    ['diff', '--name-status', '--diff-filter=AMR', mergeBase, headSha],
    { cwd, encoding: 'utf8' },
  )
  const classified = classifyChangedFiles(parseGitNameStatus(diffOut))
  if (classified.allTests.length === 0) {
    writeGithubSummary(['## Bug Regression at Base — Failed', '', 'No new or changed test files found.'], summaryFile)
    return { ok: false, reason: 'no-tests', failedTests: [], failedSuites: [] }
  }

  overlayTestFilesFromHead(cwd, headSha, classified.filesToCopy)
  const reportDir = mkdtempSync(path.join(tmpdir(), 'bug-reg-base-'))
  try {
    const specs = customSuites
      ? customSuites.map((s) => ({ ...s, reportPath: path.join(reportDir, `${s.suite}.json`) }))
      : buildSuiteSpecs(cwd, classified, reportDir)

    const suiteRuns = []
    for (const spec of specs) {
      if (spec.prepare && spec.prepare() !== 0) {
        writeGithubSummary(['## Bug Regression at Base — Failed', '', `Setup failed for ${spec.suite}.`], summaryFile)
        return { ok: false, reason: `${spec.suite}-setup-failed`, failedTests: [], failedSuites: [] }
      }
      const exitCode = spec.run(spec.reportPath)
      suiteRuns.push({ suite: spec.suite, exitCode, reportPath: spec.reportPath })
    }

    const evaluation = evaluateBaseRunResults(suiteRuns)
    writeBaseRunSummary(evaluation, summaryFile)
    return evaluation
  } finally {
    rmSync(reportDir, { recursive: true, force: true })
  }
}

function parseCliArgs(argv) {
  /** @type {Record<string, string>} */
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--') && i + 1 < argv.length) {
      args[token.slice(2)] = argv[i + 1]
      i += 1
    }
  }
  return args
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = parseCliArgs(process.argv.slice(2))
  const mode = args.mode || 'preflight'
  const cwd = process.cwd()

  if (mode === 'preflight') {
    const baseRef = args['base-ref'] || `origin/${process.env.BASE_REF || 'main'}`
    const headSha = args.head || process.env.HEAD_SHA || 'HEAD'
    const labels = process.env.PR_LABELS_JSON ? JSON.parse(process.env.PR_LABELS_JSON) : undefined
    const result = runPreflight({ cwd, baseRef, headSha, prBody: process.env.PR_BODY ?? '', labels })
    if (!result.ok) {
      console.error(result.reason)
      process.exit(1)
    }
    console.log(`Preflight decision: ${result.decision}${result.reason ? ` (${result.reason})` : ''}`)
    process.exit(0)
  }

  if (mode === 'run') {
    if (!args.base || !args.head) {
      console.error('Missing required --base <sha> and --head <sha> arguments')
      process.exit(1)
    }
    const result = runAtBase({ cwd, mergeBase: args.base, headSha: args.head })
    if (!result.ok) {
      console.error(`Base regression check failed: ${result.reason}`)
      process.exit(1)
    }
    console.log(
      `Base regression check passed: ${result.failedTests.length} failing test(s), ${result.failedSuites.length} failing suite(s) on base.`,
    )
    process.exit(0)
  }

  console.error(`Unknown --mode: ${mode}`)
  process.exit(1)
}

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { fetchPullRequestDataFromApi, scanPullRequestContent } from './pilot-name-guard.mjs'

const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'pilot-name-guard.mjs',
)

const SYNTHETIC_PATTERN = 'SyntheticPilotTokenAlpha'
const SYNTHETIC_PATTERNS_RAW = `${SYNTHETIC_PATTERN}\nSyntheticPilotAliasBeta\n`

test('WHEN a PR body contains a pattern from the secret THEN the job fails and names the field, not the text', () => {
  const result = scanPullRequestContent({
    rawPatterns: SYNTHETIC_PATTERNS_RAW,
    prTitle: 'chore: update CI workflow',
    prBody: `This PR mentions ${SYNTHETIC_PATTERN.toLowerCase()} in the summary.`,
    headRef: 'feature/aut-997-clean-branch',
    commits: [{ sha: 'abc1234567890', message: 'chore: clean commit' }],
    diffText: '',
  })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'pattern-matched')
  assert.deepEqual(result.violations, ['PR body'])
  assert.match(result.message, /PR body/)
  assert.equal(result.message.toLowerCase().includes(SYNTHETIC_PATTERN.toLowerCase()), false)
})

test('WHEN a PR title contains a pattern from the secret THEN the job fails and names the field, not the text', () => {
  const result = scanPullRequestContent({
    rawPatterns: SYNTHETIC_PATTERNS_RAW,
    prTitle: `feat: onboarding for ${SYNTHETIC_PATTERN}`,
    prBody: 'Clean body',
    headRef: 'feature/aut-997-clean-branch',
    commits: [],
    diffText: '',
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.violations, ['PR title'])
  assert.match(result.message, /PR title/)
  assert.equal(result.message.toLowerCase().includes(SYNTHETIC_PATTERN.toLowerCase()), false)
})

test('WHEN a commit message or the head branch name contains a pattern THEN the job fails', () => {
  const branchHit = scanPullRequestContent({
    rawPatterns: SYNTHETIC_PATTERNS_RAW,
    prTitle: 'chore: clean title',
    prBody: 'Clean body',
    headRef: `feature/${SYNTHETIC_PATTERN.toLowerCase()}-fix`,
    commits: [{ sha: '1111222233334444', message: 'chore: clean commit' }],
    diffText: '',
  })

  assert.equal(branchHit.ok, false)
  assert.deepEqual(branchHit.violations, ['head branch name'])
  assert.equal(branchHit.message.toLowerCase().includes(SYNTHETIC_PATTERN.toLowerCase()), false)

  const commitHit = scanPullRequestContent({
    rawPatterns: SYNTHETIC_PATTERNS_RAW,
    prTitle: 'chore: clean title',
    prBody: 'Clean body',
    headRef: 'feature/clean-branch',
    commits: [{ sha: '1111222233334444', message: 'fix: mention syntheticpilotaliasbeta' }],
    diffText: '',
  })

  assert.equal(commitHit.ok, false)
  assert.deepEqual(commitHit.violations, ['commit 111122223333 message'])
  assert.equal(commitHit.message.toLowerCase().includes('syntheticpilotaliasbeta'), false)
})

test('WHEN an added diff line contains a pattern (any case) THEN the job fails with file and line', () => {
  const diffText = [
    'diff --git a/apps/core-api/src/example.ts b/apps/core-api/src/example.ts',
    'index 1111111..2222222 100644',
    '--- a/apps/core-api/src/example.ts',
    '+++ b/apps/core-api/src/example.ts',
    '@@ -10,0 +11,2 @@ export function demo() {',
    '+  const clean = true',
    `+  const bad = '${SYNTHETIC_PATTERN.toUpperCase()}'`,
    '@@ -25 +27 @@ export function other() {',
    '-  const removed = "SyntheticPilotTokenAlpha"',
    `+  const alsoBad = 'SyntheticPilotAliasBeta'`,
    '@@ -40,7 +40,7 @@ export function withContext() {',
    '   const ctx1 = 1',
    `   const ctx2 = '${SYNTHETIC_PATTERN}' // pre-existing context line must not match`,
    '   const ctx3 = 3',
    '-  const oldLine = 4',
    `+  const addedInContextHunk = '${SYNTHETIC_PATTERN}'`,
    '   const ctx4 = 5',
    '   const ctx5 = 6',
    '   const ctx6 = 7',
    '\\ No newline at end of file',
  ].join('\n')

  const result = scanPullRequestContent({
    rawPatterns: SYNTHETIC_PATTERNS_RAW,
    prTitle: 'chore: clean title',
    prBody: 'Clean body',
    headRef: 'feature/clean-branch',
    commits: [{ sha: 'deadbeef123456', message: 'chore: clean commit' }],
    diffText,
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.violations, [
    'apps/core-api/src/example.ts:12',
    'apps/core-api/src/example.ts:27',
    'apps/core-api/src/example.ts:43',
  ])
  assert.match(result.message, /apps\/core-api\/src\/example\.ts:12/)
  assert.match(result.message, /apps\/core-api\/src\/example\.ts:27/)
  assert.match(result.message, /apps\/core-api\/src\/example\.ts:43/)
  assert.equal(result.message.toLowerCase().includes(SYNTHETIC_PATTERN.toLowerCase()), false)
})

test('WHEN no pattern occurs anywhere THEN the job passes', () => {
  const diffText = [
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1 +1 @@',
    '-old line',
    '+pilot customer clean line',
  ].join('\n')

  const result = scanPullRequestContent({
    rawPatterns: SYNTHETIC_PATTERNS_RAW,
    prTitle: 'chore: update docs for pilot customer',
    prBody: 'Clean summary',
    headRef: 'feature/clean-branch',
    commits: [{ sha: '1234567890abcdef', message: 'docs: update readme' }],
    diffText,
  })

  assert.equal(result.ok, true)
  assert.equal(result.reason, 'clean')
  assert.deepEqual(result.violations, [])
})

test('WHEN the secret is unavailable THEN the job fails closed', () => {
  for (const rawPatterns of [undefined, '', '   \n\n  ']) {
    const result = scanPullRequestContent({
      rawPatterns,
      prTitle: 'chore: clean title',
      prBody: 'Clean body',
      headRef: 'feature/clean-branch',
      commits: [],
      diffText: '',
    })

    assert.equal(result.ok, false)
    assert.equal(result.reason, 'missing-secret')
    assert.match(result.message, /PILOT_NAME_PATTERNS/)
  }
})

test('CLI integration: failing run logs 0 hits of test pattern and missing secret fails closed', () => {
  const dir = mkdtempSync(joinTmpDir())
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir })

    writeFileSync(path.join(dir, 'sample.txt'), 'line 1\nline 2\n')
    execFileSync('git', ['add', 'sample.txt'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir })
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()

    execFileSync('git', ['checkout', '-b', `feature/${SYNTHETIC_PATTERN}`], { cwd: dir })
    writeFileSync(
      path.join(dir, 'sample.txt'),
      `line 1\nline 2\n${SYNTHETIC_PATTERN.toLowerCase()}\n`,
    )
    execFileSync('git', ['add', 'sample.txt'], { cwd: dir })
    execFileSync('git', ['commit', '-m', `feat: add ${SYNTHETIC_PATTERN}`], { cwd: dir })

    const failRun = spawnSync('node', [SCRIPT_PATH], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PILOT_NAME_PATTERNS: SYNTHETIC_PATTERNS_RAW,
        PR_TITLE: `PR ${SYNTHETIC_PATTERN}`,
        PR_BODY: `Body ${SYNTHETIC_PATTERN}`,
        HEAD_REF: `feature/${SYNTHETIC_PATTERN}`,
        MERGE_BASE: baseSha,
      },
    })

    assert.equal(failRun.status, 1)
    const combinedOutput = `${failRun.stdout}\n${failRun.stderr}`
    assert.match(combinedOutput, /PR title/)
    assert.match(combinedOutput, /PR body/)
    assert.match(combinedOutput, /head branch name/)
    assert.match(combinedOutput, /sample\.txt:3/)
    assert.equal(
      combinedOutput.toLowerCase().includes(SYNTHETIC_PATTERN.toLowerCase()),
      false,
      'Output must never leak the matched pattern',
    )

    const missingSecretRun = spawnSync('node', [SCRIPT_PATH], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PILOT_NAME_PATTERNS: '',
        PR_TITLE: 'Clean PR',
        PR_BODY: 'Clean body',
        HEAD_REF: 'feature/clean',
        MERGE_BASE: baseSha,
      },
    })

    assert.equal(missingSecretRun.status, 1)
    assert.match(missingSecretRun.stderr, /PILOT_NAME_PATTERNS/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('WHEN diff --git, rename to, or +++ path contains a pattern THEN fails with diff file path and never prints the path', () => {
  const renameDiff = [
    `diff --git a/docs/old.md b/docs/${SYNTHETIC_PATTERN}.md`,
    'similarity index 100%',
    'rename from docs/old.md',
    `rename to docs/${SYNTHETIC_PATTERN}.md`,
  ].join('\n')

  const renameResult = scanPullRequestContent({
    rawPatterns: SYNTHETIC_PATTERNS_RAW,
    prTitle: 'docs: rename file',
    prBody: 'Clean body',
    headRef: 'feature/clean',
    commits: [],
    diffText: renameDiff,
  })

  assert.equal(renameResult.ok, false)
  assert.deepEqual(renameResult.violations, ['diff file path'])
  assert.equal(renameResult.message.toLowerCase().includes(SYNTHETIC_PATTERN.toLowerCase()), false)

  const newFileWithCleanContentDiff = [
    `diff --git a/docs/${SYNTHETIC_PATTERN}.md b/docs/${SYNTHETIC_PATTERN}.md`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/docs/${SYNTHETIC_PATTERN}.md`,
    '@@ -0,0 +1 @@',
    '+hello',
  ].join('\n')

  const newFileResult = scanPullRequestContent({
    rawPatterns: SYNTHETIC_PATTERNS_RAW,
    prTitle: 'docs: add file',
    prBody: 'Clean body',
    headRef: 'feature/clean',
    commits: [],
    diffText: newFileWithCleanContentDiff,
  })

  assert.equal(newFileResult.ok, false)
  assert.deepEqual(newFileResult.violations, ['diff file path'])
  assert.equal(newFileResult.message.toLowerCase().includes(SYNTHETIC_PATTERN.toLowerCase()), false)

  const bothPathAndLineMatchDiff = [
    `diff --git a/docs/${SYNTHETIC_PATTERN}.md b/docs/${SYNTHETIC_PATTERN}.md`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/docs/${SYNTHETIC_PATTERN}.md`,
    '@@ -0,0 +1 @@',
    `+hello ${SYNTHETIC_PATTERN}`,
  ].join('\n')

  const bothResult = scanPullRequestContent({
    rawPatterns: SYNTHETIC_PATTERNS_RAW,
    prTitle: 'docs: add file',
    prBody: 'Clean body',
    headRef: 'feature/clean',
    commits: [],
    diffText: bothPathAndLineMatchDiff,
  })

  assert.equal(bothResult.ok, false)
  assert.deepEqual(bothResult.violations, ['diff file path'])
  assert.equal(bothResult.message.toLowerCase().includes(SYNTHETIC_PATTERN.toLowerCase()), false)
})

// Regression: the GitHub API diff quotes non-ASCII paths with octal escapes, so a pattern
// with umlauts never matched the raw header and the quoted path leaked into `path:line` hits.
test('WHEN a quoted octal-escaped diff path decodes to a pattern THEN fails with diff file path only', () => {
  const umlautPatterns = 'Müller\n'
  const quoted = '"b/docs/M\\303\\274ller.md"'
  const newFileDiff = [
    `diff --git "a/docs/M\\303\\274ller.md" ${quoted}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ ${quoted}`,
    '@@ -0,0 +1 @@',
    '+hello müller',
  ].join('\n')

  const newFileResult = scanPullRequestContent({
    rawPatterns: umlautPatterns,
    prTitle: 'docs: add file',
    prBody: 'Clean body',
    headRef: 'feature/clean',
    commits: [],
    diffText: newFileDiff,
  })
  assert.equal(newFileResult.ok, false)
  assert.deepEqual(newFileResult.violations, ['diff file path'])

  const renameOnlyDiff = [
    'diff --git a/docs/old.md "b/docs/M\\303\\274ller.md"',
    'similarity index 100%',
    'rename from docs/old.md',
    'rename to "docs/M\\303\\274ller.md"',
  ].join('\n')
  const renameResult = scanPullRequestContent({
    rawPatterns: umlautPatterns,
    prTitle: 'docs: rename',
    prBody: 'Clean body',
    headRef: 'feature/clean',
    commits: [],
    diffText: renameOnlyDiff,
  })
  assert.equal(renameResult.ok, false)
  assert.deepEqual(renameResult.violations, ['diff file path'])

  const cleanQuotedPathDiff = [
    `diff --git "a/docs/G\\303\\274nther.md" "b/docs/G\\303\\274nther.md"`,
    `+++ "b/docs/G\\303\\274nther.md"`,
    '@@ -0,0 +1 @@',
    '+hello müller',
  ].join('\n')
  const lineResult = scanPullRequestContent({
    rawPatterns: umlautPatterns,
    prTitle: 'docs: add file',
    prBody: 'Clean body',
    headRef: 'feature/clean',
    commits: [],
    diffText: cleanQuotedPathDiff,
  })
  assert.deepEqual(lineResult.violations, ['docs/Günther.md:1'])
})

test('CLI integration: base-tree execution scans GIT_HEAD_REF as data without checking out PR head', () => {
  const dir = mkdtempSync(joinTmpDir())
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir })

    writeFileSync(path.join(dir, 'base.txt'), 'clean base\n')
    execFileSync('git', ['add', 'base.txt'], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()

    execFileSync('git', ['checkout', '-b', 'feature/pr-data'], { cwd: dir, stdio: 'ignore' })
    writeFileSync(path.join(dir, `${SYNTHETIC_PATTERN}.md`), 'clean line\n')
    execFileSync('git', ['add', `${SYNTHETIC_PATTERN}.md`], { cwd: dir })
    execFileSync('git', ['commit', '-m', 'add file'], { cwd: dir, stdio: 'ignore' })
    const prHeadSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()

    // Switch back to base tree (main) before running the guard, mirroring pull_request_target.
    execFileSync('git', ['checkout', 'main'], { cwd: dir, stdio: 'ignore' })

    const result = spawnSync('node', [SCRIPT_PATH], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PILOT_NAME_PATTERNS: SYNTHETIC_PATTERNS_RAW,
        PR_TITLE: 'Clean PR',
        PR_BODY: 'Clean body',
        HEAD_REF: 'feature/pr-data',
        MERGE_BASE: baseSha,
        GIT_HEAD_REF: prHeadSha,
      },
    })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /diff file path/)
    assert.equal(result.stderr.toLowerCase().includes(SYNTHETIC_PATTERN.toLowerCase()), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Workflow security: build.yaml test job is secret-free and pull_request_target workflow runs from base tree', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const buildYaml = readFileSync(path.join(repoRoot, '.github/workflows/build.yaml'), 'utf8')
  assert.equal(buildYaml.includes('PILOT_NAME_PATTERNS'), false)
  assert.match(buildYaml, /npm run pilot-name-guard:test/)

  const targetWorkflow = readFileSync(
    path.join(repoRoot, '.github/workflows/pilot-name-guard.yaml'),
    'utf8',
  )
  assert.match(targetWorkflow, /pull_request_target:/)
  // pull_request_target runs the workflow and the checked-out script from the PR base branch,
  // so only protected `main` may be a target; a feature-branch base would let pushers swap the script.
  assert.match(targetWorkflow, /branches:\s*\n\s*-\s*main\s*\n\s*types:/)
  assert.doesNotMatch(targetWorkflow, /feat\/\*|feature\/\*/)
  assert.match(targetWorkflow, /contents:\s*read/)
  assert.match(targetWorkflow, /ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/)
  assert.match(targetWorkflow, /persist-credentials:\s*false/)
  assert.match(targetWorkflow, /PR_NUMBER:\s*\$\{\{\s*github\.event\.pull_request\.number\s*\}\}/)
  assert.match(targetWorkflow, /secrets\.PILOT_NAME_PATTERNS/)
  assert.match(targetWorkflow, /node \.github\/scripts\/pilot-name-guard\.mjs/)
})

test('fetchPullRequestDataFromApi loads PR commits and unified diff as read-only data', async () => {
  /** @type {Array<{ url: string, accept: string }>} */
  const calls = []
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), accept: String(init?.headers?.Accept ?? '') })
    if (String(url).includes('/commits')) {
      return new Response(
        JSON.stringify([{ sha: 'abc1234567890', commit: { message: 'feat: sample' } }]),
        { status: 200 },
      )
    }
    return new Response(`diff --git a/a.txt b/a.txt\n+++ b/a.txt\n@@ -0,0 +1 @@\n+${SYNTHETIC_PATTERN}\n`, {
      status: 200,
    })
  }

  const data = await fetchPullRequestDataFromApi({
    repo: 'vandean25/auto-core-platform',
    prNumber: 1280,
    token: 'tok',
    fetchImpl: mockFetch,
  })

  assert.equal(calls.length, 2)
  assert.deepEqual(data.commits, [{ sha: 'abc1234567890', message: 'feat: sample' }])
  const scan = scanPullRequestContent({
    rawPatterns: SYNTHETIC_PATTERNS_RAW,
    prTitle: 'Clean',
    prBody: 'Clean',
    headRef: 'feature/clean',
    commits: data.commits,
    diffText: data.diffText,
  })
  assert.equal(scan.ok, false)
  assert.deepEqual(scan.violations, ['a.txt:1'])
})

function joinTmpDir() {
  return path.join(tmpdir(), 'pilot-name-guard-')
}

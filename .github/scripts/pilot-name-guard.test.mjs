import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { scanPullRequestContent } from './pilot-name-guard.mjs'

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
  ])
  assert.match(result.message, /apps\/core-api\/src\/example\.ts:12/)
  assert.match(result.message, /apps\/core-api\/src\/example\.ts:27/)
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
  assert.match(targetWorkflow, /contents:\s*read/)
  assert.match(targetWorkflow, /ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/)
  assert.match(targetWorkflow, /persist-credentials:\s*false/)
  assert.match(targetWorkflow, /refs\/pull\/\$\{\{\s*github\.event\.pull_request\.number\s*\}\}\/head/)
  assert.match(targetWorkflow, /secrets\.PILOT_NAME_PATTERNS/)
  assert.match(targetWorkflow, /node \.github\/scripts\/pilot-name-guard\.mjs/)
})

function joinTmpDir() {
  return path.join(tmpdir(), 'pilot-name-guard-')
}

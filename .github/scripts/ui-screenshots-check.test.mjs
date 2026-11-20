import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  hasScreenshotOrNa,
  isUiComponentPath,
  runUiScreenshotsCheckCli,
  verifyUiScreenshots,
} from './ui-screenshots-check.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('Scenario 1: fails and lists Foo.tsx when UI tsx changes without image or n/a line', () => {
  const result = verifyUiScreenshots({
    changedPaths: ['apps/core-web/src/pages/x/Foo.tsx'],
    prBody: '## Summary\nUpdated Foo page\n\n## Screenshots\n<!-- paste here -->\n',
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.uiFiles, ['apps/core-web/src/pages/x/Foo.tsx'])

  const errors = []
  const exitCode = runUiScreenshotsCheckCli(
    { baseRef: 'main', prBody: '## Summary\nUpdated Foo page', repoRoot: REPO_ROOT },
    {
      changedPaths: ['apps/core-web/src/pages/x/Foo.tsx'],
      logError: (msg) => errors.push(msg),
    },
  )

  assert.equal(exitCode, 1)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /Foo\.tsx/)
  assert.match(errors[0], /Screenshots: n\/a/)
  assert.match(errors[0], /image|screenshot/i)
})

test('Scenario 2: passes when PR body contains markdown image, img tag, or GitHub attachment URL', () => {
  const changedPaths = ['apps/core-web/src/pages/x/Foo.tsx']

  for (const prBody of [
    '![before](https://github.com/user-attachments/assets/abc-123)',
    '<img width="800" alt="after" src="https://github.com/user-attachments/assets/abc-123" />',
    'https://github.com/user-attachments/assets/abc-123',
  ]) {
    const result = verifyUiScreenshots({ changedPaths, prBody })
    assert.equal(result.ok, true, `Expected pass for body: ${prBody}`)
  }
})

test('Scenario 3: passes with Screenshots: n/a – <reason> and fails without reason', () => {
  const changedPaths = ['apps/core-web/src/pages/x/Foo.tsx']

  assert.equal(
    verifyUiScreenshots({
      changedPaths,
      prBody: 'Screenshots: n/a – copy-only change',
    }).ok,
    true,
  )

  assert.equal(
    verifyUiScreenshots({
      changedPaths,
      prBody: 'Screenshots: n/a - refactor without visual change',
    }).ok,
    true,
  )

  assert.equal(
    verifyUiScreenshots({
      changedPaths,
      prBody: 'Screenshots: n/a –   ',
    }).ok,
    false,
  )

  assert.equal(
    verifyUiScreenshots({
      changedPaths,
      prBody: 'Screenshots: n/a -',
    }).ok,
    false,
  )

  assert.equal(
    hasScreenshotOrNa('<!-- Screenshots: n/a – <reason> -->'),
    false,
  )
})

test('Scenario 3b: passes with Screenshots: Playwright attachments – <names> and fails without names', () => {
  const changedPaths = ['apps/core-web/src/pages/x/Foo.tsx']
  const cases = [
    ['Screenshots: Playwright attachments – picker-cleared-de-375, picker-cleared-en-375', true],
    ['Screenshots: playwright attachment - picker-cleared-de-375', true],
    ['Screenshots: Playwright attachments: picker-cleared-de-375', true],
    ['Screenshots: Playwright attachments –   ', false],
    ['Screenshots: Playwright attachments', false],
    ['<!-- Screenshots: Playwright attachments – picker-cleared-de-375 -->', false],
  ]
  for (const [prBody, ok] of cases) {
    assert.equal(verifyUiScreenshots({ changedPaths, prBody }).ok, ok, prBody)
  }
})

test('Scenario 4: passes without screenshots when only core-web test files change', () => {
  const testOnlyPaths = [
    'apps/core-web/src/pages/x/Foo.test.tsx',
    'apps/core-web/src/pages/x/Foo.spec.tsx',
    'apps/core-web/src/test/TestWrapper.tsx',
    'apps/core-web/src/pages/x/__tests__/Helper.tsx',
  ]

  for (const filePath of testOnlyPaths) {
    assert.equal(isUiComponentPath(filePath), false, `Expected ${filePath} to be excluded`)
  }

  const result = verifyUiScreenshots({
    changedPaths: testOnlyPaths,
    prBody: '',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.uiFiles, [])
})

test('Scenario 5 & Anti-criterion: passes when only backend, docs, or .ts files change with empty body', () => {
  const result = verifyUiScreenshots({
    changedPaths: [
      'apps/core-api/src/sales/sales.service.ts',
      'apps/core-web/src/api/useSales.ts',
      'docs/README.md',
    ],
    prBody: '',
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.uiFiles, [])
})

test('Anti-criterion: build.yaml passes PR_BODY only via env and never interpolates it into shell', () => {
  const workflow = readFileSync(path.join(REPO_ROOT, '.github/workflows/build.yaml'), 'utf8')

  assert.match(workflow, /node \.github\/scripts\/ui-screenshots-check\.mjs/)
  assert.match(workflow, /npm run ui-screenshots-check:test/)

  // Verify no run: block interpolates pull_request.body directly into shell
  const runBlocks = [...workflow.matchAll(/^\s*run:\s*\|?\s*\n((?:\s{10,}.*\n?)*)/gm)]
  for (const match of runBlocks) {
    assert.doesNotMatch(match[1], /github\.event\.pull_request\.body/)
  }
})

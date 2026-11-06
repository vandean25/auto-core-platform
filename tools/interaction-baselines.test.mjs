import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  INTERACTION_BASELINES,
  checkBaselineGrowth,
  findBaselineGrowth,
} from './interaction-baselines-lib.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const SCRIPT = path.join(REPO_ROOT, 'tools/check-interaction-baselines.mjs')

const MUTATION = INTERACTION_BASELINES.find((entry) => entry.file.endsWith('mutation-classification.baseline.json'))
const PARITY = INTERACTION_BASELINES.find((entry) => entry.file.endsWith('registry-parity.baseline.json'))

const guardDocument = (violations) =>
  JSON.stringify({ schemaVersion: 1, guard: 'mutation-classification', violations })

const compare = (baseViolations, headViolations) =>
  checkBaselineGrowth({
    baselines: [MUTATION],
    readBase: () => (baseViolations === undefined ? undefined : guardDocument(baseViolations)),
    readHead: () => (headViolations === undefined ? undefined : guardDocument(headViolations)),
  })[0]

describe('baseline growth', () => {
  it('rejects a baseline entry that the PR base does not have', () => {
    const result = compare(
      ['api/orders.ts::useArchiveOrder::missing-mutation-key'],
      [
        'api/orders.ts::useArchiveOrder::missing-mutation-key',
        'api/invoices.ts::useVoidInvoice::missing-mutation-key',
      ],
    )

    assert.equal(result.status, 'grew')
    assert.deepEqual(result.growth, ['api/invoices.ts::useVoidInvoice::missing-mutation-key'])
  })

  it('rejects a duplicate entry because identical violations are counted', () => {
    assert.deepEqual(findBaselineGrowth(['a'], ['a', 'a']), ['a'])
  })

  it('accepts a baseline that shrank or stayed the same', () => {
    assert.equal(compare(['a', 'b'], ['a']).status, 'ok')
    assert.equal(compare(['a'], ['a']).status, 'ok')
  })

  it('treats a baseline file that is new on the head as a guard activation', () => {
    const result = compare(undefined, ['a', 'b'])

    assert.equal(result.status, 'activated')
    assert.deepEqual(result.growth, [])
  })

  it('reads the identities of the older baseline layouts', () => {
    const layout = checkBaselineGrowth({
      baselines: [PARITY],
      readBase: () => JSON.stringify(['pages/a.tsx::Button::save']),
      readHead: () => JSON.stringify(['pages/a.tsx::Button::save', 'pages/b.tsx::Button::archive']),
    })[0]

    assert.deepEqual(layout.growth, ['pages/b.tsx::Button::archive'])
  })
})

describe('check-interaction-baselines CLI', () => {
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' })

  function repoWithBaselineChange(headViolations) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interaction-baselines-'))
    const file = path.join(dir, MUTATION.file)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'config', 'user.email', 'ci@example.test')
    git(dir, 'config', 'user.name', 'CI')
    fs.writeFileSync(file, guardDocument(['api/orders.ts::useArchiveOrder::missing-mutation-key']))
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'base')
    fs.writeFileSync(file, guardDocument(headViolations))
    return dir
  }

  // The CLI resolves the repo root from its own location, so run a copy of tools/ inside the fixture repo.
  function runCli(dir, ...args) {
    fs.cpSync(path.join(REPO_ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true })
    try {
      execFileSync('node', [path.join(dir, 'tools/check-interaction-baselines.mjs'), ...args], {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf8',
      })
      return { status: 0, stderr: '' }
    } catch (error) {
      return { status: error.status, stderr: String(error.stderr) }
    }
  }

  it('exits 1 and names the grown entry', () => {
    const dir = repoWithBaselineChange([
      'api/orders.ts::useArchiveOrder::missing-mutation-key',
      'api/new.ts::useNew::missing-mutation-key',
    ])

    const { status, stderr } = runCli(dir, '--base', 'HEAD')

    assert.equal(status, 1)
    assert.match(stderr, /\+ api\/new\.ts::useNew::missing-mutation-key/)
  })

  it('exits 0 when the baseline only shrank', () => {
    assert.equal(runCli(repoWithBaselineChange([]), '--base', 'HEAD').status, 0)
  })

  it('exits 2 when the base ref cannot be resolved', () => {
    assert.equal(runCli(repoWithBaselineChange([]), '--base', 'origin/missing').status, 2)
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  findAddedBaselineEntries,
  findLoosenedBaselineEntries,
} from './spec-quality-baseline-ratchet.mjs'
import { checkBaselineGrowth, findBaselineStructureViolations, INTERACTION_BASELINES } from './interaction-baselines-lib.mjs'
import { runCheckerAtBaseRevision } from './guardrail-base-runner.mjs'
import {
  GROWTH_ALLOWLISTS,
  checkAllowlistGrowth,
  extractRecipientAllowlistExports,
  extractSystemPrismaDelegates,
} from './allowlist-growth-lib.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

function initRepo(dir) {
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'ci@example.test')
  git(dir, 'config', 'user.name', 'CI')
}

function writeAndCommit(dir, rel, content, message) {
  const target = path.join(dir, rel)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
  git(dir, 'add', rel)
  git(dir, 'commit', '-q', '-m', message)
}

function runNode(cwd, script, args = []) {
  try {
    execFileSync(process.execPath, [script, ...args], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, GUARDRAIL_REPO_ROOT: cwd },
    })
    return { status: 0, stderr: '', stdout: '' }
  } catch (error) {
    return { status: error.status, stderr: String(error.stderr), stdout: String(error.stdout) }
  }
}

describe('AUT-924 guardrail ratchets', () => {
  it('specQualityFailsOnAddedEntry', () => {
    const base = [{ file: 'a.spec.ts', rule: 'bare-spy-assertion', key: 'spy' }]
    const head = [
      ...base,
      { file: 'b.spec.ts', rule: 'weak-existence-assertion', key: 'exists only' },
    ]
    assert.equal(findAddedBaselineEntries(base, head).length, 1)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-quality-added-'))
    initRepo(dir)
    writeAndCommit(
      dir,
      'tools/spec-quality-baseline.json',
      JSON.stringify({ allowlist: base }, null, 2),
      'base baseline',
    )
    fs.writeFileSync(
      path.join(dir, 'tools/spec-quality-baseline.json'),
      JSON.stringify({ allowlist: head }, null, 2),
    )
    const failed = runNode(
      dir,
      path.join(REPO_ROOT, 'tools/check-spec-quality.mjs'),
      ['--base', 'HEAD'],
    )
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /grew/)
  })

  it('specQualityFailsOnLoosenedEntry', () => {
    const base = [{ file: 'large.spec.ts', rule: 'thin-large-spec', key: 'specific test' }]
    const head = [{ file: 'large.spec.ts', rule: 'thin-large-spec', key: '*' }]
    assert.equal(findLoosenedBaselineEntries(base, head).length, 1)

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-quality-loosened-'))
    initRepo(dir)
    writeAndCommit(
      dir,
      'tools/spec-quality-baseline.json',
      JSON.stringify({ allowlist: base }, null, 2),
      'base',
    )
    fs.writeFileSync(
      path.join(dir, 'tools/spec-quality-baseline.json'),
      JSON.stringify({ allowlist: head }, null, 2),
    )
    const failed = runNode(
      dir,
      path.join(REPO_ROOT, 'tools/check-spec-quality.mjs'),
      ['--base', 'HEAD'],
    )
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /loosened/)
  })

  it('interactionBaselineFailsOnDeleteOrRename', () => {
    const baseline = INTERACTION_BASELINES[0]
    const fileContent = JSON.stringify(['pages/a.tsx::Button::save'], null, 2)
    const removed = checkBaselineGrowth({
      baselines: [baseline],
      readBase: () => fileContent,
      readHead: () => undefined,
    })
    assert.equal(findBaselineStructureViolations(removed).length, 1)

    const renamedTarget = {
      file: 'apps/core-web/src/features/interaction/guards/renamed.baseline.json',
      identities: (document) => document.violations ?? [],
    }
    const renamedPayload = JSON.stringify({ schemaVersion: 1, violations: ['x'] })
    const renamed = checkBaselineGrowth({
      baselines: [baseline, renamedTarget],
      readBase: (file) => (file === baseline.file ? fileContent : undefined),
      readHead: (file) =>
        file === baseline.file ? undefined : file === renamedTarget.file ? renamedPayload : undefined,
    })
    assert.ok(findBaselineStructureViolations(renamed).some((result) => result.status === 'renamed'))

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interaction-delete-'))
    initRepo(dir)
    for (const entry of INTERACTION_BASELINES) {
      const empty =
        entry.file.endsWith('registry-parity.baseline.json')
          ? JSON.stringify([], null, 2)
          : JSON.stringify({ schemaVersion: 1, violations: [] }, null, 2)
      writeAndCommit(dir, entry.file, fs.existsSync(path.join(REPO_ROOT, entry.file))
        ? fs.readFileSync(path.join(REPO_ROOT, entry.file), 'utf8')
        : empty, `baseline ${entry.file}`)
    }
    assert.equal(
      runNode(dir, path.join(REPO_ROOT, 'tools/check-interaction-baselines.mjs'), ['--base', 'HEAD']).status,
      0,
    )
    fs.rmSync(path.join(dir, baseline.file))
    const failed = runNode(
      dir,
      path.join(REPO_ROOT, 'tools/check-interaction-baselines.mjs'),
      ['--base', 'HEAD'],
    )
    assert.equal(failed.status, 1)
    assert.match(failed.stderr, /structure|removed/i)
  })

  function linkWorkspaceNodeModules(dir) {
    const target = path.join(dir, 'node_modules')
    if (!fs.existsSync(target)) {
      fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), target, 'dir')
    }
  }

  it('checkersRunFromBaseRevision', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-base-'))
    initRepo(dir)
    fs.cpSync(path.join(REPO_ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'tools/spec-quality-baseline.json'),
      JSON.stringify({ allowlist: [] }, null, 2),
    )
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'base tools and baseline')
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()

    const tampered = path.join(dir, 'tools/check-spec-quality.mjs')
    fs.writeFileSync(tampered, "console.log('tampered'); process.exit(0)\n")
    fs.writeFileSync(
      path.join(dir, 'tools/spec-quality-baseline.json'),
      JSON.stringify(
        {
          allowlist: [{ file: 'evil.spec.ts', rule: 'weak-existence-assertion', key: 'only exists' }],
        },
        null,
        2,
      ),
    )
    git(dir, 'add', '.')
    git(dir, 'commit', '-q', '-m', 'head tamper and baseline growth')

    assert.throws(
      () =>
        runCheckerAtBaseRevision({
          repoRoot: dir,
          base: baseSha,
          bundleName: 'spec-quality',
          checkerArgs: ['--base', baseSha],
        }),
      (error) => {
        assert.equal(error.status, 1)
        assert.match(String(error.stderr ?? error.message), /grew/)
        return true
      },
    )
  })

  it('checkersRunAllowlistGrowthFromBaseRevision', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-allowlist-base-'))
    initRepo(dir)
    linkWorkspaceNodeModules(dir)
    fs.cpSync(path.join(REPO_ROOT, 'tools'), path.join(dir, 'tools'), { recursive: true })
    git(dir, 'add', 'tools')
    const prefetch = 'apps/core-web/src/features/interaction/intent-prefetch-exceptions.json'
    const guardDocument = (files) =>
      JSON.stringify(
        { schemaVersion: 1, exceptions: files.map((file) => ({ file, reason: 'r' })) },
        null,
        2,
      )
    writeAndCommit(dir, prefetch, guardDocument(['pages/a.tsx']), 'base allowlist')
    const baseSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()

    const okOutput = runCheckerAtBaseRevision({
      repoRoot: dir,
      base: baseSha,
      bundleName: 'allowlist-growth',
      checkerArgs: ['--base', baseSha],
    })
    assert.match(okOutput, /passed/)

    fs.writeFileSync(path.join(dir, prefetch), guardDocument(['pages/a.tsx', 'pages/b.tsx']))
    git(dir, 'add', prefetch)
    git(dir, 'commit', '-q', '-m', 'head growth')

    assert.throws(
      () =>
        runCheckerAtBaseRevision({
          repoRoot: dir,
          base: baseSha,
          bundleName: 'allowlist-growth',
          checkerArgs: ['--base', baseSha],
        }),
      (error) => {
        assert.equal(error.status, 1)
        assert.match(String(error.stderr ?? error.stdout ?? error.message), /grew|allowlist/i)
        return true
      },
    )
  })

  it('allowlistGrowthFailsPrefetchAndI18n', () => {
    const entryById = Object.fromEntries(GROWTH_ALLOWLISTS.map((entry) => [entry.id, entry]))
    const cases = [
      {
        entry: entryById['intent-prefetch-exceptions'],
        base: JSON.stringify(
          { schemaVersion: 1, exceptions: [{ file: 'pages/a.tsx', reason: 'no detail route' }] },
          null,
          2,
        ),
        head: JSON.stringify(
          {
            schemaVersion: 1,
            exceptions: [
              { file: 'pages/a.tsx', reason: 'no detail route' },
              { file: 'pages/b.tsx', reason: 'new exception' },
            ],
          },
          null,
          2,
        ),
      },
      {
        entry: entryById['i18n-check-manifest'],
        base: JSON.stringify({ treatNamespaceAsUsed: ['errors'], usedKeyPrefixes: ['a.'], usedKeys: [] }, null, 2),
        head: JSON.stringify(
          { treatNamespaceAsUsed: ['errors'], usedKeyPrefixes: ['a.', 'b.'], usedKeys: [] },
          null,
          2,
        ),
      },
    ]
    for (const { entry, base, head } of cases) {
      const [result] = checkAllowlistGrowth({
        allowlists: [entry],
        readBase: () => base,
        readHead: () => head,
      })
      assert.equal(result.status, 'grew', entry.id)
    }
  })

  const entryById = Object.fromEntries(GROWTH_ALLOWLISTS.map((entry) => [entry.id, entry]))
  const serviceGetterStub = `export class SystemPrismaService {
  get tenant() { return null }
}
`
  const serviceGetterGrowth = `export class SystemPrismaService {
  get tenant() { return null }
  get customer() { return null }
}
`
  const recipientPath = path.join(
    REPO_ROOT,
    'apps/core-api/src/notifications/email/recipient-allowlist.ts',
  )
  const recipientBase = fs.readFileSync(recipientPath, 'utf8')

  const tenantBypassCases = [
    {
      name: 'system-prisma delegate growth',
      entry: entryById['system-prisma-delegates'],
      base: "export const SYSTEM_PRISMA_MODEL_DELEGATES = ['tenant', 'user'] as const\n",
      head: "export const SYSTEM_PRISMA_MODEL_DELEGATES = ['tenant', 'user', 'customer'] as const\n",
      status: 'grew',
      growth: ['customer'],
    },
    {
      name: 'system-prisma wrong const',
      entry: entryById['system-prisma-delegates'],
      base: "export const SYSTEM_PRISMA_MODEL_DELEGATES = ['tenant', 'user'] as const\n",
      head: "export const TENANT_BYPASS = ['tenant', 'user', 'customer'] as const\n",
      status: 'unparseable',
    },
    {
      name: 'system-prisma double-quote bypass',
      entry: entryById['system-prisma-delegates'],
      base: "export const SYSTEM_PRISMA_MODEL_DELEGATES = ['tenant', 'user'] as const\n",
      head: 'export const SYSTEM_PRISMA_MODEL_DELEGATES = [\'tenant\', "customer"] as const\n',
      status: 'unparseable',
    },
    {
      name: 'system-prisma service getter growth',
      entry: entryById['system-prisma-service-getters'],
      base: serviceGetterStub,
      head: serviceGetterGrowth,
      status: 'grew',
      growth: ['customer'],
    },
    {
      name: 'recipient export growth',
      entry: entryById['recipient-allowlist-exports'],
      base: 'export function parseRecipientAllowlist() {}\n',
      head: 'export function parseRecipientAllowlist() {}\nexport const bypassAllowlist = true\n',
      status: 'grew',
      growth: ['bypassAllowlist'],
    },
    {
      name: 'recipient star export growth',
      entry: entryById['recipient-allowlist-exports'],
      base: recipientBase,
      head: `${recipientBase}\nexport * from './bypass.js';\n`,
      status: 'grew',
      growth: ['export*from:./bypass.js'],
    },
    {
      name: 'prefetch allowlist shrink',
      entry: entryById['intent-prefetch-exceptions'],
      base: JSON.stringify({
        schemaVersion: 1,
        exceptions: [
          { file: 'pages/a.tsx', reason: 'r' },
          { file: 'pages/b.tsx', reason: 'r' },
        ],
      }),
      head: JSON.stringify({
        schemaVersion: 1,
        exceptions: [{ file: 'pages/a.tsx', reason: 'r' }],
      }),
      status: 'ok',
    },
  ]

  for (const scenario of tenantBypassCases) {
    it(`allowlistGrowthFailsTenantBypassAndRecipient: ${scenario.name}`, () => {
      const [result] = checkAllowlistGrowth({
        allowlists: [scenario.entry],
        readBase: () => scenario.base,
        readHead: () => scenario.head,
      })
      assert.equal(result.status, scenario.status, scenario.name)
      if (scenario.growth) assert.deepEqual(result.growth, scenario.growth)
    })
  }

  it('extractSystemPrismaDelegates rejects malformed inventories', () => {
    assert.equal(
      extractSystemPrismaDelegates("export const TENANT_BYPASS = ['a'] as const\n"),
      null,
    )
    assert.equal(
      extractSystemPrismaDelegates(
        "export const SYSTEM_PRISMA_MODEL_DELEGATES = ['tenant', `customer`] as const\n",
      ),
      null,
    )
  })

  it('allowlistGrowthCliFailsOnGrowthRemovedAndMissingBase', () => {
    const entry = GROWTH_ALLOWLISTS.find((row) => row.id === 'intent-prefetch-exceptions')
    const guardDocument = (files) =>
      JSON.stringify({ schemaVersion: 1, exceptions: files.map((file) => ({ file, reason: 'r' })) }, null, 2)

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'allowlist-growth-cli-'))
    initRepo(dir)
    writeAndCommit(dir, entry.file, guardDocument(['pages/a.tsx']), 'base allowlist')
    fs.writeFileSync(
      path.join(dir, entry.file),
      guardDocument(['pages/a.tsx', 'pages/b.tsx']),
    )
    const growth = runNode(dir, path.join(REPO_ROOT, 'tools/check-allowlist-growth.mjs'), ['--base', 'HEAD'])
    assert.equal(growth.status, 1)
    assert.match(growth.stderr, /grew/)

    const removedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'allowlist-growth-removed-'))
    initRepo(removedDir)
    writeAndCommit(removedDir, entry.file, guardDocument(['pages/a.tsx']), 'base allowlist')
    fs.rmSync(path.join(removedDir, entry.file))
    const removed = runNode(removedDir, path.join(REPO_ROOT, 'tools/check-allowlist-growth.mjs'), ['--base', 'HEAD'])
    assert.equal(removed.status, 1)
    assert.match(removed.stderr, /removed/)

    const missingBase = runNode(
      dir,
      path.join(REPO_ROOT, 'tools/check-allowlist-growth.mjs'),
      ['--base', 'origin/does-not-exist'],
    )
    assert.equal(missingBase.status, 2)
  })
})

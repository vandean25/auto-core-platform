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
import { checkAllowlistGrowth } from './allowlist-growth-lib.mjs'

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
      (error) => error.status === 1,
    )
  })

  it('allowlistGrowthFailsPrefetchAndI18n', () => {
    const prefetchBase = JSON.stringify(
      { schemaVersion: 1, exceptions: [{ file: 'pages/a.tsx', reason: 'no detail route' }] },
      null,
      2,
    )
    const prefetchHead = JSON.stringify(
      {
        schemaVersion: 1,
        exceptions: [
          { file: 'pages/a.tsx', reason: 'no detail route' },
          { file: 'pages/b.tsx', reason: 'new exception' },
        ],
      },
      null,
      2,
    )
    const prefetch = checkAllowlistGrowth({
      allowlists: [
        {
          id: 'intent-prefetch-exceptions',
          file: 'apps/core-web/src/features/interaction/intent-prefetch-exceptions.json',
          identities(text) {
            return JSON.parse(text).exceptions.map((entry) => entry.file)
          },
        },
      ],
      readBase: () => prefetchBase,
      readHead: () => prefetchHead,
    })
    assert.equal(prefetch[0].status, 'grew')

    const manifestBase = JSON.stringify({ treatNamespaceAsUsed: ['errors'], usedKeyPrefixes: ['a.'], usedKeys: [] }, null, 2)
    const manifestHead = JSON.stringify(
      { treatNamespaceAsUsed: ['errors'], usedKeyPrefixes: ['a.', 'b.'], usedKeys: [] },
      null,
      2,
    )
    const manifest = checkAllowlistGrowth({
      allowlists: [
        {
          id: 'i18n-check-manifest',
          file: 'tools/i18n-check-manifest.json',
          identities(text) {
            const document = JSON.parse(text)
            return [...document.treatNamespaceAsUsed, ...document.usedKeyPrefixes, ...(document.usedKeys ?? [])]
          },
        },
      ],
      readBase: () => manifestBase,
      readHead: () => manifestHead,
    })
    assert.equal(manifest[0].status, 'grew')
  })

  it('allowlistGrowthFailsTenantBypassAndRecipient', () => {
    const typesBase = "export const SYSTEM_PRISMA_MODEL_DELEGATES = ['tenant', 'user'] as const\n"
    const typesHead = "export const SYSTEM_PRISMA_MODEL_DELEGATES = ['tenant', 'user', 'customer'] as const\n"
    const prisma = checkAllowlistGrowth({
      allowlists: [
        {
          id: 'system-prisma-delegates',
          file: 'apps/core-api/src/prisma/system-prisma.types.ts',
          identities: (text) => [...text.matchAll(/'([^']+)'/g)].map((part) => part[1]),
        },
      ],
      readBase: () => typesBase,
      readHead: () => typesHead,
    })
    assert.deepEqual(prisma[0].growth, ['customer'])

    const recipientBase = 'export function parseRecipientAllowlist() {}\n'
    const recipientHead =
      'export function parseRecipientAllowlist() {}\nexport function bypassRecipientAllowlist() {}\n'
    const recipient = checkAllowlistGrowth({
      allowlists: [
        {
          id: 'recipient-allowlist-exports',
          file: 'apps/core-api/src/notifications/email/recipient-allowlist.ts',
          identities: (text) => [...text.matchAll(/^export function (\w+)/gm)].map((part) => part[1]),
        },
      ],
      readBase: () => recipientBase,
      readHead: () => recipientHead,
    })
    assert.deepEqual(recipient[0].growth, ['bypassRecipientAllowlist'])
  })
})

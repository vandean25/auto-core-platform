import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  allocatePortPair,
  basePortPairFromSeed,
  buildPostgresUrl,
  databaseNameFromSlug,
  hashSeed,
  isProtectedPrimaryBranch,
  parseEnvContent,
  redactEnvPreview,
  rewriteEnvContent,
  sanitizeWorktreeDirectoryName,
} from './worktree-lib.mjs'

describe('worktree-lib port allocation', () => {
  it('derives stable base ports from seed', () => {
    const a = basePortPairFromSeed('/worktrees/agent-a')
    const b = basePortPairFromSeed('/worktrees/agent-a')
    const c = basePortPairFromSeed('/worktrees/agent-b')
    assert.deepEqual(a, b)
    assert.notEqual(a.apiPort, c.apiPort)
    assert.equal(a.apiPort % 2, 1)
    assert.equal(a.webPort % 2, 0)
  })

  it('hashSeed is stable', () => {
    assert.equal(hashSeed('foo'), hashSeed('foo'))
    assert.notEqual(hashSeed('foo'), hashSeed('bar'))
  })

  it('allocatePortPair probes when defaults are taken', async () => {
    const blocked = new Set([basePortPairFromSeed('blocked').apiPort])
    const pair = await allocatePortPair({
      seed: 'blocked',
      maxAttempts: 5,
      isFree: async (port) => !blocked.has(port),
    })
    assert.notEqual(pair.apiPort, basePortPairFromSeed('blocked').apiPort)
    assert.ok(pair.webPort > 5173)
  })
})

describe('worktree-lib env rewriting', () => {
  it('preserves comments and unrelated keys', () => {
    const input = `# header
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgresql://old
`
    const out = rewriteEnvContent(input, {
      PORT: '3011',
      DATABASE_URL: 'postgresql://new',
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:3011',
    })
    assert.match(out, /^# header/m)
    assert.match(out, /LOG_LEVEL=info/)
    assert.match(out, /PORT=3011/)
    assert.match(out, /DATABASE_URL=postgresql:\/\/new/)
    assert.match(out, /VITE_API_PROXY_TARGET=http:\/\/127\.0\.0\.1:3011/)
  })

  it('parseEnvContent keeps blank lines', () => {
    const lines = parseEnvContent('A=1\n\n# c\nB=2')
    assert.equal(lines.filter((l) => l.type === 'blank').length, 1)
    assert.equal(lines.filter((l) => l.type === 'entry').length, 2)
  })

  it('redactEnvPreview never exposes secret values', () => {
    const preview = redactEnvPreview({
      PORT: '3011',
      SECRET_ENCRYPTION_KEY: 'super-secret-base64',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/acp_x',
    })
    assert.equal(preview.PORT, '3011')
    assert.equal(preview.SECRET_ENCRYPTION_KEY, '(set, redacted)')
    assert.equal(preview.DATABASE_URL, '(set, redacted)')
    assert.ok(!JSON.stringify(preview).includes('super-secret'))
    assert.ok(!JSON.stringify(preview).includes('postgres:postgres'))
  })
})

describe('worktree-lib database slugging', () => {
  it('normalizes worktree names into postgres-safe db names', () => {
    assert.equal(databaseNameFromSlug('My Agent'), 'acp_my_agent')
    assert.equal(databaseNameFromSlug('AUT-4005/foo'), 'acp_aut_4005_foo')
    assert.ok(databaseNameFromSlug('x').startsWith('acp_'))
    assert.ok(databaseNameFromSlug('a'.repeat(80)).length <= 63)
  })

  it('buildPostgresUrl encodes credentials', () => {
    const url = buildPostgresUrl({
      database: 'acp_demo',
      port: 5433,
      password: 'p@ss',
    })
    assert.equal(url, 'postgresql://postgres:p%40ss@localhost:5433/acp_demo?schema=public')
  })
})

describe('worktree-lib branch guards', () => {
  it('sanitizeWorktreeDirectoryName strips unsafe characters', () => {
    assert.equal(sanitizeWorktreeDirectoryName('  foo bar!! '), 'foo-bar')
  })

  it('isProtectedPrimaryBranch flags main/master', () => {
    assert.equal(isProtectedPrimaryBranch('main'), true)
    assert.equal(isProtectedPrimaryBranch('feature/x'), false)
  })
})

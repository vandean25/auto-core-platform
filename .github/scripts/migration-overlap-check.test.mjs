import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { runMigrationOverlapCheck } from './migration-overlap-check.mjs'

const SCRIPT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'migration-overlap-check.mjs',
)
const WORKFLOW_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../workflows/pr-hints.yaml',
)

const THIS_FOLDER = '20260302120000_this_pr'
const OTHER_FOLDER = '20260303120000_other_pr'
const MAIN_FOLDER = '20260301120000_on_main'
const HINT =
  'rebase after the other PR merges; if your folder timestamp is older than the newest on main, create a fresh migration instead of editing a merged one'

/**
 * @param {unknown} body
 * @param {{ status?: number, link?: string }} [options]
 */
function jsonResponse(body, options = {}) {
  const status = options.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === 'link' ? (options.link ?? null) : null
      },
    },
    json: async () => body,
  }
}

/**
 * @param {string} url
 * @param {{ page1?: object[], page2?: object[], filesByPr?: Record<string, object[]>, status?: number }} routes
 */
function stubFetch(routes) {
  return async (url) => {
    if (routes.status && routes.status >= 500) {
      return jsonResponse({ message: 'unavailable' }, { status: routes.status })
    }
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/pulls')) {
      const page = parsed.searchParams.get('page') ?? '1'
      const body = page === '1' ? (routes.page1 ?? []) : (routes.page2 ?? [])
      const link =
        page === '1' && routes.page2
          ? `<${parsed.origin}${parsed.pathname}?state=open&base=main&per_page=100&page=2>; rel="next"`
          : undefined
      return jsonResponse(body, { link })
    }
    const filesMatch = /\/pulls\/(\d+)\/files$/.exec(parsed.pathname)
    if (filesMatch) {
      return jsonResponse(routes.filesByPr?.[filesMatch[1]] ?? [])
    }
    return jsonResponse({ message: 'not found' }, { status: 404 })
  }
}

/**
 * @param {object[]} pulls
 * @param {Record<string, object[]>} filesByPr
 * @param {{ addedFolders?: string[], newestOnMain?: string | null, status?: number, page1?: object[], page2?: object[] }} [extra]
 */
function check(filesByPr, extra = {}) {
  const page2 = extra.page2 ?? [{ number: 12 }, { number: 77 }]
  return runMigrationOverlapCheck({
    currentPrNumber: 12,
    repo: 'acme/widgets',
    token: 'test-token',
    apiBase: 'https://api.github.test',
    baseRef: 'main',
    addedFolders: extra.addedFolders ?? [THIS_FOLDER],
    newestOnMain: extra.newestOnMain === undefined ? MAIN_FOLDER : extra.newestOnMain,
    fetchImpl: stubFetch({
      status: extra.status,
      page1: extra.page1 ?? [{ number: 41 }],
      page2,
      filesByPr,
    }),
    log() {},
  })
}

function addedMigration(folder) {
  return {
    filename: `apps/core-api/prisma/migrations/${folder}/migration.sql`,
    status: 'added',
  }
}

test('WHEN this PR adds a migration and another open PR adds one too THEN a warning names that PR and both folders', async () => {
  const result = await check({
    41: [{ filename: 'README.md', status: 'modified' }],
    12: [addedMigration(THIS_FOLDER)],
    77: [addedMigration(OTHER_FOLDER)],
  })

  const warning = result.logs.find((line) => line.startsWith('::warning::'))
  assert.ok(warning)
  assert.match(warning, /#77/)
  assert.match(warning, new RegExp(THIS_FOLDER))
  assert.match(warning, new RegExp(OTHER_FOLDER))
  assert.equal(warning.includes('#12'), false)
  assert.match(warning, new RegExp(HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(result.summary, /#77/)
  assert.match(result.summary, new RegExp(THIS_FOLDER))
  assert.match(result.summary, new RegExp(OTHER_FOLDER))
  assert.match(result.summary, new RegExp(HINT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('WHEN no other open PR adds a migration THEN no warning and the summary says "no overlap"', async () => {
  const result = await check({
    41: [{ filename: 'docs/readme.md', status: 'modified' }],
    77: [{ filename: 'apps/core-api/src/app.module.ts', status: 'modified' }],
  })

  assert.equal(
    result.logs.some((line) => line.includes('::warning::')),
    false,
  )
  assert.match(result.summary, /no overlap/)
})

test('WHEN another PR only modifies schema.prisma without a migration folder THEN no warning', async () => {
  const result = await check(
    {
      77: [{ filename: 'apps/core-api/prisma/schema.prisma', status: 'modified' }],
    },
    {
      page1: [{ number: 77 }],
      page2: [],
    },
  )

  assert.equal(
    result.logs.some((line) => line.includes('::warning::')),
    false,
  )
})

test('WHEN the GitHub API returns 5xx THEN the job prints a warning and exits 0', async () => {
  const result = await check({}, { status: 503 })

  assert.equal(result.exitCode, 0)
  const warning = result.logs.find((line) => line.startsWith('::warning::'))
  assert.ok(warning)
  assert.match(warning, /503/)
})

test("WHEN this PR's new folder timestamp is older than the newest folder on main THEN an extra warning says so", async () => {
  const olderFolder = '20260201000000_older_than_main'
  const newestOnMain = '20260315120000_newest_on_main'
  const result = await check(
    { 77: [addedMigration(OTHER_FOLDER)] },
    { addedFolders: [olderFolder], newestOnMain },
  )

  const stale = result.logs.find(
    (line) => line.startsWith('::warning::') && line.includes(olderFolder),
  )
  assert.ok(stale)
  assert.match(stale, /older/i)
  assert.match(stale, new RegExp(newestOnMain))
  assert.match(stale, /main/)
  const overlap = result.logs.find((line) => line.startsWith('::warning::') && line.includes('#77'))
  assert.ok(overlap)
  assert.notEqual(stale, overlap)
})

test('overlap fixture exits 0', { timeout: 15_000 }, async () => {
  const repo = initFixtureRepo()
  const summaryPath = path.join(repo.cwd, 'summary.md')
  const stub = await startStub((requestUrl) => {
    const parsed = new URL(requestUrl, 'http://stub.local')
    if (parsed.pathname.endsWith('/pulls')) {
      return {
        status: 200,
        body: [{ number: 88 }, { number: 12 }],
      }
    }
    if (parsed.pathname.endsWith('/pulls/88/files')) {
      return { status: 200, body: [addedMigration('20260304120000_open_pr')] }
    }
    if (parsed.pathname.endsWith('/pulls/12/files')) {
      return { status: 200, body: [addedMigration(THIS_FOLDER)] }
    }
    return { status: 404, body: { message: 'not found' } }
  })

  try {
    const result = await runScript(repo.cwd, {
      ...process.env,
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'acme/widgets',
      PR_NUMBER: '12',
      BASE_REF: 'main',
      GITHUB_API_URL: stub.url,
      REPO_ROOT: repo.cwd,
      GITHUB_STEP_SUMMARY: summaryPath,
    })

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /::warning::/)
    assert.match(result.stdout, /#88/)
    assert.match(result.stdout, /20260304120000_open_pr/)
    assert.match(result.stdout, new RegExp(THIS_FOLDER))
    const summary = readFileSync(summaryPath, 'utf8')
    assert.match(summary, /#88/)
    assert.match(summary, /20260304120000_open_pr/)
    assert.match(summary, new RegExp(THIS_FOLDER))
    assert.match(summary, /rebase after the other PR merges/)
  } finally {
    await stub.close()
    rmSync(repo.cwd, { recursive: true, force: true })
  }
})

test('pr-hints.yaml permissions are read-only and name no secrets beyond GITHUB_TOKEN', () => {
  const yaml = readFileSync(WORKFLOW_PATH, 'utf8')
  const blocks = parsePermissionBlocks(yaml)
  assert.equal(blocks.length, 1)
  assert.deepEqual(blocks[0], { contents: 'read', 'pull-requests': 'read' })
  assert.equal(yaml.includes('secrets.'), false)
  assert.equal(/\bwrite\b/.test(yaml), false)
})

/**
 * @param {string} yaml
 * @returns {Array<Record<string, string>>}
 */
function parsePermissionBlocks(yaml) {
  const lines = yaml.split(/\r?\n/)
  /** @type {Array<Record<string, string>>} */
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const header = /^( *)permissions:\s*(.*)$/.exec(lines[i])
    if (!header) continue
    const inline = header[2].trim()
    if (inline && !inline.startsWith('#')) {
      blocks.push({ inline })
      continue
    }
    const indent = header[1].length
    /** @type {Record<string, string>} */
    const block = {}
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j]
      if (line.trim() === '' || /^\s*#/.test(line)) continue
      const current = /^( *)/.exec(line)[1].length
      if (current <= indent) break
      const entry = /^([A-Za-z0-9_-]+):\s*(\S+)/.exec(line.trim())
      if (!entry) continue
      block[entry[1]] = entry[2]
    }
    blocks.push(block)
  }
  return blocks
}

/**
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string }>}
 */
function runScript(cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH], { cwd, env })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

function initFixtureRepo() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'migration-overlap-'))
  const git = (args) => execFileSync('git', args, { cwd, stdio: 'pipe' })
  git(['init', '-b', 'main'])
  git(['config', 'user.email', 'dev@example.com'])
  git(['config', 'user.name', 'Dev'])
  git(['config', 'commit.gpgsign', 'false'])
  const mainDir = path.join(cwd, 'apps/core-api/prisma/migrations', MAIN_FOLDER)
  mkdirSync(mainDir, { recursive: true })
  writeFileSync(path.join(mainDir, 'migration.sql'), '-- on main\n')
  git(['add', '.'])
  git(['commit', '-m', 'main migration'])
  git(['checkout', '-b', 'feature'])
  const prDir = path.join(cwd, 'apps/core-api/prisma/migrations', THIS_FOLDER)
  mkdirSync(prDir, { recursive: true })
  writeFileSync(path.join(prDir, 'migration.sql'), '-- this pr\n')
  git(['add', '.'])
  git(['commit', '-m', 'pr migration'])
  return { cwd }
}

/**
 * @param {(url: string) => { status: number, body: unknown, link?: string }} handler
 */
function startStub(handler) {
  const server = createServer((req, res) => {
    const result = handler(req.url ?? '/')
    const headers = { 'content-type': 'application/json' }
    if (result.link) headers.link = result.link
    res.writeHead(result.status, headers)
    res.end(JSON.stringify(result.body))
  })
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('stub server has no port'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()))
          }),
      })
    })
  })
}

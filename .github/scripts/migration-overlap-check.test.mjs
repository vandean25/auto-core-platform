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

function jsonResponse(body, options) {
  const status = options.status ?? 200
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() !== 'link') return null
        return options.link ?? null
      },
    },
    json: async () => body,
  }
}

function listOrEmpty(value) {
  return value ?? []
}

function pageBody(routes, page) {
  if (page === '1') return listOrEmpty(routes.page1)
  return listOrEmpty(routes.page2)
}

function hasNextPage(routes) {
  return Boolean(routes.page2) && routes.page2.length > 0
}

function nextPullsLink(parsed, routes, page) {
  if (page !== '1' || !hasNextPage(routes)) return undefined
  return `<${parsed.origin}${parsed.pathname}?state=open&base=main&per_page=100&page=2>; rel="next"`
}

function filesResponse(pathname, filesByPr) {
  const filesMatch = /\/pulls\/(\d+)\/files$/.exec(pathname)
  if (!filesMatch) return null
  const files = filesByPr[filesMatch[1]] ?? []
  return jsonResponse(files, {})
}

function pullsPage(url) {
  return new URL(url).searchParams.get('page') || '1'
}

function pullsResponse(url, routes) {
  const parsed = new URL(url)
  const page = pullsPage(url)
  return jsonResponse(pageBody(routes, page), { link: nextPullsLink(parsed, routes, page) })
}

function routeResponse(url, routes) {
  if (new URL(url).pathname.endsWith('/pulls')) return pullsResponse(url, routes)
  return filesResponse(new URL(url).pathname, routes.filesByPr)
}

function responseForUrl(url, routes) {
  if (routes.status >= 500) return jsonResponse({ message: 'unavailable' }, { status: routes.status })
  return routeResponse(url, routes) ?? jsonResponse({ message: 'not found' }, { status: 404 })
}

function addedFoldersOf(extra) {
  return extra.addedFolders ?? [THIS_FOLDER]
}

function newestOf(extra) {
  if (extra.newestOnMain === undefined) return MAIN_FOLDER
  return extra.newestOnMain
}

function page1Of(extra) {
  return extra.page1 ?? [{ number: 41 }]
}

function page2Of(extra) {
  return extra.page2 ?? [{ number: 12 }, { number: 77 }]
}

function check(filesByPr, extra) {
  const options = extra ?? {}
  return runMigrationOverlapCheck({
    currentPrNumber: 12,
    repo: 'acme/widgets',
    token: 'test-token',
    apiBase: 'https://api.github.test',
    baseRef: 'main',
    addedFolders: addedFoldersOf(options),
    newestOnMain: newestOf(options),
    fetchImpl: (url) =>
      responseForUrl(url, {
        status: options.status,
        page1: page1Of(options),
        page2: page2Of(options),
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
  assert.match(warning, new RegExp(escapeRegExp(HINT)))
  assert.match(result.summary, /#77/)
  assert.match(result.summary, new RegExp(THIS_FOLDER))
  assert.match(result.summary, new RegExp(OTHER_FOLDER))
  assert.match(result.summary, new RegExp(escapeRegExp(HINT)))
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
    { page1: [{ number: 77 }], page2: [] },
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

  const stale = result.logs.find((line) => line.startsWith('::warning::') && line.includes(olderFolder))
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
  const stub = await startStub((requestUrl) => stubRoute(requestUrl))

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
    assertOverlapExit(result, summaryPath)
  } finally {
    await stub.close()
    rmSync(repo.cwd, { recursive: true, force: true })
  }
})

function assertOverlapExit(result, summaryPath) {
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
}

function stubRoute(requestUrl) {
  const parsed = new URL(requestUrl, 'http://stub.local')
  if (parsed.pathname.endsWith('/pulls')) return { status: 200, body: [{ number: 88 }, { number: 12 }] }
  if (parsed.pathname.endsWith('/pulls/88/files')) {
    return { status: 200, body: [addedMigration('20260304120000_open_pr')] }
  }
  if (parsed.pathname.endsWith('/pulls/12/files')) return { status: 200, body: [addedMigration(THIS_FOLDER)] }
  return { status: 404, body: { message: 'not found' } }
}

test('pr-hints.yaml permissions are read-only and name no secrets beyond GITHUB_TOKEN', () => {
  const yaml = readFileSync(WORKFLOW_PATH, 'utf8')
  const lines = yaml.split(/\r?\n/)
  const starts = permissionStarts(lines)
  assert.equal(starts.length, 1)
  assert.deepEqual(permissionBody(lines, starts[0]), ['contents: read', 'pull-requests: read'])
  assert.equal(yaml.includes('secrets.'), false)
  assert.equal(/\bwrite\b/.test(yaml), false)
})

function isBlankOrComment(line) {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

function permissionStarts(lines) {
  const starts = []
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === 'permissions:') starts.push(index)
  }
  return starts
}

function nextPermissionLine(line) {
  if (isBlankOrComment(line)) return 'skip'
  if (!line.startsWith('  ')) return 'stop'
  return line.trim()
}

function appendPermission(block, line) {
  const entry = nextPermissionLine(line)
  if (entry === 'skip') return true
  if (entry === 'stop') return false
  block.push(entry)
  return true
}

function permissionBody(lines, start) {
  const block = []
  for (const line of lines.slice(start + 1)) {
    if (!appendPermission(block, line)) break
  }
  return block
}

function runScript(cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH], { cwd, env })
    const output = { stdout: '', stderr: '' }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output.stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      output.stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout: output.stdout, stderr: output.stderr }))
  })
}

function gitIn(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function commitMigration(cwd, folder, sql, message) {
  const dir = path.join(cwd, 'apps/core-api/prisma/migrations', folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'migration.sql'), sql)
  gitIn(cwd, ['add', '.'])
  gitIn(cwd, ['commit', '-m', message])
}

function initFixtureRepo() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'migration-overlap-'))
  gitIn(cwd, ['init', '-b', 'main'])
  gitIn(cwd, ['config', 'user.email', 'dev@example.com'])
  gitIn(cwd, ['config', 'user.name', 'Dev'])
  gitIn(cwd, ['config', 'commit.gpgsign', 'false'])
  commitMigration(cwd, MAIN_FOLDER, '-- on main\n', 'main migration')
  gitIn(cwd, ['checkout', '-b', 'feature'])
  commitMigration(cwd, THIS_FOLDER, '-- this pr\n', 'pr migration')
  return { cwd }
}

function stubHeaders(result) {
  if (!result.link) return { 'content-type': 'application/json' }
  return { 'content-type': 'application/json', link: result.link }
}

function sendStub(res, result) {
  res.writeHead(result.status, stubHeaders(result))
  res.end(JSON.stringify(result.body))
}

function onStubRequest(handler, req, res) {
  sendStub(res, handler(req.url ?? '/'))
}

function stubAddress(server) {
  const address = server.address()
  if (!address || typeof address === 'string') return null
  return address
}

function closeServer(server) {
  return new Promise((done, fail) => {
    server.close((error) => finishClose(done, fail, error))
  })
}

function finishClose(done, fail, error) {
  if (error) {
    fail(error)
    return
  }
  done()
}

function onStubListening(server, resolve, reject) {
  const address = stubAddress(server)
  if (!address) {
    reject(new Error('stub server has no port'))
    return
  }
  resolve({
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  })
}

function startStub(handler) {
  const server = createServer((req, res) => onStubRequest(handler, req, res))
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => onStubListening(server, resolve, reject))
  })
}

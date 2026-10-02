import { readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = resolve(webRoot, '../..')
const apiRoot = resolve(repoRoot, 'apps/core-api')
const pidFile = resolve(fileURLToPath(new URL('.', import.meta.url)), '.pids.json')

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/auto_core_test'
const jwtSecret =
  process.env.TEST_JWT_SECRET ?? 'e2e-fullstack-fixed-secret-min-32-chars-xx'
const apiPort = process.env.E2E_FULLSTACK_API_PORT ?? '3100'
const webPort = process.env.E2E_FULLSTACK_WEB_PORT ?? '5175'

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

async function waitForUrl(url, timeoutMs = 120_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function stopServers() {
  try {
    const pids = JSON.parse(readFileSync(pidFile, 'utf8'))
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

function killListenersOnPort(port) {
  const result = spawnSync('fuser', ['-k', `${port}/tcp`], { stdio: 'ignore' })
  if (result.status === 0) {
    return
  }
  const lsof = spawnSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' })
  if (lsof.status !== 0 || !lsof.stdout.trim()) {
    return
  }
  for (const pid of lsof.stdout.trim().split('\n')) {
    try {
      process.kill(Number(pid), 'SIGTERM')
    } catch {
      // ignore
    }
  }
}

stopServers()
killListenersOnPort(Number(apiPort))
killListenersOnPort(Number(webPort))

run('npm', ['run', 'build', '--workspace=core-api'], repoRoot)

run('npm', ['exec', '--', 'prisma', 'migrate', 'deploy'], apiRoot, {
  DATABASE_URL: databaseUrl,
})

run('npm', ['run', 'e2e-fullstack:seed:ci', '--workspace=core-api'], repoRoot, {
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'test',
  TEST_JWT_SECRET: jwtSecret,
})

const apiEnv = {
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'test',
  TEST_JWT_SECRET: jwtSecret,
  PORT: apiPort,
  INVOICE_BRANDING_WRITER_ENABLED: 'true',
  INVOICE_PDF_BUCKET: 'e2e-fullstack-invoice-pdf',
  E2E_FULLSTACK_IN_MEMORY_PDF: 'true',
  FRONTEND_URL: `http://localhost:${webPort}`,
}

const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: apiRoot,
  env: { ...process.env, ...apiEnv },
  stdio: 'inherit',
  detached: true,
})
api.unref()

const vite = spawn(process.execPath, ['./e2e-fullstack/run-vite.mjs'], {
  cwd: webRoot,
  env: {
    ...process.env,
    E2E_FULLSTACK_WEB_PORT: webPort,
    E2E_FULLSTACK_API_PORT: apiPort,
  },
  stdio: 'inherit',
  detached: true,
})
vite.unref()

writeFileSync(
  pidFile,
  `${JSON.stringify([api.pid, vite.pid].filter(Boolean))}\n`,
  'utf8',
)

await waitForUrl(`http://127.0.0.1:${apiPort}/api/health`)
await waitForUrl(`http://localhost:${webPort}`)

const playwright = spawn(
  process.execPath,
  [
    resolve(repoRoot, 'node_modules/@playwright/test/cli.js'),
    'test',
    '-c',
    'playwright.fullstack.config.ts',
  ],
  {
    cwd: webRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  },
)

playwright.on('exit', (code) => {
  stopServers()
  process.exit(code ?? 0)
})

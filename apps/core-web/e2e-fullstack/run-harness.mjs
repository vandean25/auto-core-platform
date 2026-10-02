import { readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  E2E_FULLSTACK_API_PORT as DEFAULT_API_PORT,
  E2E_FULLSTACK_JWT_SECRET,
  E2E_FULLSTACK_WEB_PORT as DEFAULT_WEB_PORT,
} from './constants.mjs'

const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = resolve(webRoot, '../..')
const apiRoot = resolve(repoRoot, 'apps/core-api')
const pidFile = resolve(fileURLToPath(new URL('.', import.meta.url)), '.pids.json')

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/auto_core_test'
const jwtSecret = process.env.TEST_JWT_SECRET ?? E2E_FULLSTACK_JWT_SECRET
const apiPort = process.env.E2E_FULLSTACK_API_PORT ?? DEFAULT_API_PORT
const webPort = process.env.E2E_FULLSTACK_WEB_PORT ?? DEFAULT_WEB_PORT

const childPids = []

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
  for (const pid of childPids) {
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      try {
        process.kill(pid, 'SIGTERM')
      } catch {
        // ignore
      }
    }
  }
  childPids.length = 0

  try {
    const pids = JSON.parse(readFileSync(pidFile, 'utf8'))
    for (const pid of pids) {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        try {
          process.kill(pid, 'SIGTERM')
        } catch {
          // ignore
        }
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

function spawnDetached(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  if (child.pid) {
    childPids.push(child.pid)
  }
  return child
}

function onShutdownSignal(signal) {
  stopServers()
  killListenersOnPort(Number(apiPort))
  killListenersOnPort(Number(webPort))
  process.exit(signal === 'SIGINT' ? 130 : 143)
}

process.on('SIGINT', () => onShutdownSignal('SIGINT'))
process.on('SIGTERM', () => onShutdownSignal('SIGTERM'))

let exitCode = 1

try {
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

  spawnDetached(process.execPath, ['dist/main.js'], {
    cwd: apiRoot,
    env: { ...process.env, ...apiEnv },
  })

  spawnDetached(process.execPath, ['./e2e-fullstack/run-vite.mjs'], {
    cwd: webRoot,
    env: {
      ...process.env,
      E2E_FULLSTACK_WEB_PORT: webPort,
      E2E_FULLSTACK_API_PORT: apiPort,
    },
  })

  writeFileSync(pidFile, `${JSON.stringify(childPids)}\n`, 'utf8')

  await waitForUrl(`http://127.0.0.1:${apiPort}/api/health`)
  await waitForUrl(`http://localhost:${webPort}`)

  const playwright = spawnSync(
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

  exitCode = playwright.status ?? 1
} finally {
  stopServers()
  killListenersOnPort(Number(apiPort))
  killListenersOnPort(Number(webPort))
}

process.exit(exitCode)

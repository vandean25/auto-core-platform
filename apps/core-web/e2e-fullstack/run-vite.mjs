import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixturePath = resolve(webRoot, '.e2e-fullstack/fixture.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const webPort = process.env.E2E_FULLSTACK_WEB_PORT ?? '5175'
const apiPort = process.env.E2E_FULLSTACK_API_PORT ?? '3100'

const child = spawn(
  'npx',
  ['vite', '--port', webPort, '--strictPort'],
  {
    cwd: webRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_E2E_TEST_TOKEN: fixture.authToken,
      VITE_APP_VERSION: 'v1.0.0-e2e-fullstack',
      VITE_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
    },
  },
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

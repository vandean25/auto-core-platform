import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const PRODUCTION_LEAK_SENTINEL = 'AUT345_PROD_LEAK_SENTINEL'

describe('production bundle test-token seam', () => {
  it('refuses to ship a production build when a test token is configured', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'core-web-prod-build-'))
    const webRoot = resolve(import.meta.dirname, '..')
    const viteBin = resolve(webRoot, '../../node_modules/vite/bin/vite.js')

    try {
      const build = spawnSync(
        process.execPath,
        [
          viteBin,
          'build',
          '--mode',
          'production',
          '--outDir',
          outDir,
          '--emptyOutDir',
        ],
        {
          cwd: webRoot,
          env: {
            ...process.env,
            VITE_E2E_TEST_TOKEN: PRODUCTION_LEAK_SENTINEL,
            VITE_E2E_SKIP_AUTH: '',
          },
          stdio: 'pipe',
        },
      )

      if (build.status === 0) {
        const assetsDir = join(outDir, 'assets')
        const jsBundles = readdirSync(assetsDir).filter((file: string) =>
          file.endsWith('.js'),
        )
        const combined = jsBundles
          .map((file: string) => readFileSync(join(assetsDir, file), 'utf8'))
          .join('\n')
        expect(combined).not.toContain(PRODUCTION_LEAK_SENTINEL)
        return
      }

      const output = `${build.stderr?.toString() ?? ''}${build.stdout?.toString() ?? ''}`
      expect(output).toMatch(/VITE_E2E_TEST_TOKEN must not be set/)
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 120_000)
})

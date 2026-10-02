import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('production bundle test-token seam', () => {
  it('does not ship an enabled full-stack test-token auth seam', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'core-web-prod-build-'))

    const webRoot = resolve(process.cwd())
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
            VITE_E2E_TEST_TOKEN: '',
            VITE_E2E_SKIP_AUTH: '',
          },
          stdio: 'pipe',
        },
      )
      expect(build.status).toBe(0)
      if (build.status !== 0) {
        throw new Error(
          `${build.stderr?.toString() || build.stdout?.toString() || 'vite build failed'}`,
        )
      }

      const assetsDir = join(outDir, 'assets')
      const jsBundles = readdirSync(assetsDir).filter((file) => file.endsWith('.js'))
      expect(jsBundles.length).toBeGreaterThan(0)

      const combined = jsBundles
        .map((file) => readFileSync(join(assetsDir, file), 'utf8'))
        .join('\n')

      expect(combined).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./)
      expect(combined).not.toContain('signed-test-jwt-token')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 120_000)
})

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

/** Writes dist/version.json from VITE_APP_VERSION (git tag in Cloud Build). */
export function emitVersionJsonPlugin(appVersion: string): Plugin {
  let outDir = 'dist'

  return {
    name: 'emit-version-json',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const version = normalizeAppVersion(appVersion)
      const payload = `${JSON.stringify({ version } satisfies { version: string })}\n`
      writeFileSync(join(outDir, 'version.json'), payload, 'utf8')
    },
  }
}

function normalizeAppVersion(value: string): string {
  const trimmed = value.trim()
  return trimmed === '' ? 'dev' : trimmed
}

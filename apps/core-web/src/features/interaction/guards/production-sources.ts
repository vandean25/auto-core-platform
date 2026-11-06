import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Production source text for the interaction guards (AUT-893).
 *
 * Read straight from disk, not through `import.meta.glob`: Vitest caches transformed modules, and a
 * cached glob would not see a file added after the cache was written, so a new violation could pass
 * locally. Paths are relative to `apps/core-web/src` with forward slashes.
 */
const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

const SOURCE_FILE = /\.(?:ts|tsx|css)$/
const NON_PRODUCTION_PATTERN =
  /\.(?:test|spec|stories|testUtils)\.|(?:^|\/)__tests__\/|^api\/generated\/|^features\/interaction\/guards\//

export const productionSources: Record<string, string> = Object.fromEntries(
  readdirSync(SRC_ROOT, { recursive: true })
    .map((entry) => String(entry).split(sep).join('/'))
    .filter((path) => SOURCE_FILE.test(path) && !NON_PRODUCTION_PATTERN.test(path))
    .map((path) => [path, readFileSync(join(SRC_ROOT, path), 'utf8')] as const),
)

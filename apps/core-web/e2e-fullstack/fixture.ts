import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { E2eFullstackFixture } from '../../core-api/test/e2e-fullstack/seed-fixture.ts'

const fixturePath = resolve(
  fileURLToPath(new URL('..', import.meta.url)),
  '.e2e-fullstack/fixture.json',
)

export function loadE2eFullstackFixture(): E2eFullstackFixture {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as E2eFullstackFixture
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isOwnedByRequiredOwner,
  matchesCodeownersPattern,
  parseCodeowners,
} from './codeowners-match-lib.mjs'

test('last matching CODEOWNERS rule wins', () => {
  const fixture = `
* @someone-else
/apps/core-api/src/prisma/ @vandean25
/apps/core-api/src/prisma/tenant-isolation.extension.ts @not-the-owner
`
  const parsed = parseCodeowners(fixture)
  assert.equal(
    isOwnedByRequiredOwner('apps/core-api/src/prisma/tenant-isolation.extension.ts', parsed),
    false,
  )
  assert.equal(isOwnedByRequiredOwner('apps/core-api/src/prisma/prisma.service.ts', parsed), true)
})

test('trailing slash patterns own directory contents', () => {
  assert.equal(matchesCodeownersPattern('infra/environments/staging.tfvars.example', '/infra/'), true)
  assert.equal(matchesCodeownersPattern('packages/infra/foo', '/infra/'), false)
})

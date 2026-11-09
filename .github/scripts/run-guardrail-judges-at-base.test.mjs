import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { RUNNER_SELF_FILES } from '../../tools/guardrail-base-runner.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '../..')
const SCRIPT = path.join(import.meta.dirname, 'run-guardrail-judges-at-base.sh')

describe('run-guardrail-judges-at-base.sh', () => {
  it('lists the same bootstrap files as guardrail-base-runner RUNNER_SELF_FILES', () => {
    const script = readFileSync(SCRIPT, 'utf8')
    const listed = [...script.matchAll(/^\s+(tools\/[\w./-]+)/gm)].map((match) => match[1].trim())
    const block = listed.filter((entry) => RUNNER_SELF_FILES.includes(entry))
    assert.deepEqual([...block].sort(), [...RUNNER_SELF_FILES].sort())
  })
})

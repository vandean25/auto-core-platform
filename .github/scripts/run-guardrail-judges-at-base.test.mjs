import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { RUNNER_SELF_FILES } from '../../tools/guardrail-base-runner.mjs'

const SCRIPT = path.join(import.meta.dirname, 'run-guardrail-judges-at-base.sh')

describe('run-guardrail-judges-at-base.sh', () => {
  it('lists the same bootstrap files as guardrail-base-runner RUNNER_SELF_FILES', () => {
    const script = readFileSync(SCRIPT, 'utf8')
    const block = script.match(/SELF_FILES=\(\n([\s\S]*?)\n\)/)
    assert.ok(block, 'SELF_FILES array missing from script')
    const listed = block[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    assert.deepEqual([...listed].sort(), [...RUNNER_SELF_FILES].sort())
  })
})

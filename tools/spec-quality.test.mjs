import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { compareWithBaseline, findOffenders } from './spec-quality-lib.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const FILLER = '// filler\n'.repeat(160)

/** Fixture spec files, one deliberate offender per rule. */
const FIXTURES = {
  'thin-large.spec.ts': {
    content: `${FILLER}\nit('covers a single case', () => {\n  expect(run(1)).toBe(1)\n})\n`,
    expected: { file: 'thin-large.spec.ts', rule: 'thin-large-spec', key: '*' },
  },
  'weak-existence.spec.ts': {
    content:
      "describe('service', () => {\n  it('creates the service', () => {\n    expect(service).toBeDefined()\n  })\n})\n",
    expected: {
      file: 'weak-existence.spec.ts',
      rule: 'weak-existence-assertion',
      key: 'creates the service',
    },
  },
  'bare-spy.e2e-spec.ts': {
    content:
      "it('notifies the vendor', () => {\n  sendNotice()\n  expect(notify).toHaveBeenCalled()\n})\n",
    expected: { file: 'bare-spy.e2e-spec.ts', rule: 'bare-spy-assertion', key: 'notifies the vendor' },
  },
  'private-cast.spec.ts': {
    content:
      "it('resolves the mechanic', () => {\n  const id = (service as any).resolveMechanic()\n  expect(id).toBe('m-1')\n})\n",
    expected: { file: 'private-cast.spec.ts', rule: 'private-access', key: 'resolveMechanic' },
  },
  'private-bracket.test.ts': {
    content:
      "it('reads the cache', () => {\n  const value = service['readCache']()\n  expect(value).toBe('hit')\n})\n",
    expected: {
      file: 'private-bracket.test.ts',
      rule: 'private-access',
      key: 'readCache',
    },
  },
}

/** Writes fixture specs into a throw-away directory and returns the offenders found there. */
function offendersFromFixtures(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-quality-'))
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, name), content)
    }
    return findOffenders(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('spec quality guard', () => {
  for (const [fileName, { content, expected }] of Object.entries(FIXTURES)) {
    it(`WHEN a PR adds a spec with a deliberate offender THEN the check names file, test and rule (${expected.rule} in ${fileName})`, () => {
      assert.deepEqual(offendersFromFixtures({ [fileName]: content }), [expected])
    })
  }

  it('WHEN an offender is listed in the baseline THEN it is not flagged', () => {
    const offenders = offendersFromFixtures({
      'bare-spy.e2e-spec.ts': FIXTURES['bare-spy.e2e-spec.ts'].content,
    })
    const result = compareWithBaseline(offenders, offenders)
    assert.deepEqual(result.fresh, [])
    assert.equal(result.covered, 1)
  })

  it('flags a test titled "should be defined" even with a real assertion', () => {
    const offenders = offendersFromFixtures({
      'named.spec.ts': "it('should be defined', () => {\n  expect(build()).toBe(true)\n})\n",
    })
    assert.deepEqual(offenders, [
      { file: 'named.spec.ts', rule: 'weak-existence-assertion', key: 'should be defined' },
    ])
  })

  it('leaves tests with a real outcome check untouched', () => {
    const offenders = offendersFromFixtures({
      'good.spec.ts':
        "it('sums the stock', () => {\n  expect(total()).toBe(4)\n  expect(log).toHaveBeenCalledWith('ok')\n})\n",
    })
    assert.deepEqual(offenders, [])
  })

  it('WHEN the baseline is unchanged and no new offenders exist THEN the check passes', () => {
    execFileSync(process.execPath, ['tools/check-spec-quality.mjs'], { cwd: REPO_ROOT, stdio: 'pipe' })
  })
})

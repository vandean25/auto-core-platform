import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  checkA11yBaselineRatchet,
  checkA11yRouteExceptionsRatchet,
  compareA11yViolationsToBaseline,
} from './a11y-baseline.mjs'

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const fullstackDir = resolve(repoRoot, 'apps/core-web/e2e-fullstack')
const baselinePath = resolve(fullstackDir, 'a11y-baseline.json')
const checkpointPathsPath = resolve(fullstackDir, 'a11y-checkpoint-paths.ts')
const checkpointHelperPath = resolve(fullstackDir, 'a11y-checkpoint.ts')
const mockedA11yUtilsPath = resolve(repoRoot, 'apps/core-web/e2e/utils/a11y.ts')
const routeExceptionsPath = resolve(repoRoot, 'apps/core-web/e2e/a11y-route-exceptions.json')

function makeViolation({
  id = 'color-contrast',
  impact = 'serious',
  helpUrl = 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
  selectors = ['#main > button'],
} = {}) {
  return {
    id,
    impact,
    helpUrl,
    nodes: selectors.map((selector) => ({ target: [selector] })),
  }
}

describe('compareA11yViolationsToBaseline', () => {
  test('Scenario 1: passes when a flow screen has only baselined violations', () => {
    const baseline = {
      'sales-order-detail': {
        'color-contrast': 2,
        region: 1,
      },
    }
    const violations = [
      makeViolation({ id: 'color-contrast', selectors: ['#a', '#b'] }),
      makeViolation({ id: 'region', impact: 'moderate', selectors: ['#c'] }),
    ]

    const result = compareA11yViolationsToBaseline({
      checkpointId: 'sales-order-detail',
      pathname: '/sales-orders/123',
      violations,
      baseline,
    })

    assert.equal(result.ok, true, result.message)
  })

  test('Scenario 2: fails naming rule, checkpoint, page path, impact, help URL and selectors on a new rule', () => {
    const baseline = {
      'sales-order-detail': {
        region: 1,
      },
    }
    const violations = [
      makeViolation({ id: 'region', impact: 'moderate', selectors: ['#c'] }),
      makeViolation({
        id: 'button-name',
        impact: 'critical',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name',
        selectors: ['button.icon-only', '#save-btn'],
      }),
    ]

    const result = compareA11yViolationsToBaseline({
      checkpointId: 'sales-order-detail',
      pathname: '/sales-orders/123',
      violations,
      baseline,
    })

    assert.equal(result.ok, false)
    assert.match(result.message, /sales-order-detail/)
    assert.match(result.message, /\/sales-orders\/123/)
    assert.match(result.message, /button-name/)
    assert.match(result.message, /critical/)
    assert.match(result.message, /https:\/\/dequeuniversity\.com\/rules\/axe\/4\.10\/button-name/)
    assert.match(result.message, /button\.icon-only/)
    assert.match(result.message, /#save-btn/)
  })

  test('Scenario 3: fails when a baselined count rises', () => {
    const baseline = {
      'workshop-board': {
        'color-contrast': 1,
      },
    }
    const violations = [
      makeViolation({
        id: 'color-contrast',
        impact: 'serious',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        selectors: ['#card-1', '#card-2'],
      }),
    ]

    const result = compareA11yViolationsToBaseline({
      checkpointId: 'workshop-board',
      pathname: '/workshop/board',
      violations,
      baseline,
    })

    assert.equal(result.ok, false)
    assert.match(result.message, /workshop-board/)
    assert.match(result.message, /\/workshop\/board/)
    assert.match(result.message, /color-contrast/)
    assert.match(result.message, /#card-2/)
  })

  test('Scenario 5: fails with "remove from baseline" when a baselined violation is fixed', () => {
    const baseline = {
      'mechanic-queue': {
        'label-title-only': 1,
      },
    }

    const result = compareA11yViolationsToBaseline({
      checkpointId: 'mechanic-queue',
      pathname: '/mechanic/queue',
      violations: [],
      baseline,
    })

    assert.equal(result.ok, false)
    assert.match(result.message, /remove from baseline/i)
    assert.match(result.message, /label-title-only/)
    assert.match(result.message, /mechanic-queue/)
  })
})

describe('checkA11yBaselineRatchet', () => {
  const base = {
    'sales-order-detail': {
      'color-contrast': 2,
      region: 1,
    },
  }

  test('Scenario 4a: fails when a PR adds a new checkpoint key', () => {
    const head = {
      ...base,
      'new-screen': { region: 1 },
    }
    const result = checkA11yBaselineRatchet(base, head)
    assert.equal(result.ok, false)
    assert.match(result.message, /new-screen/)
  })

  test('Scenario 4b: fails when a PR adds a rule key to an existing checkpoint', () => {
    const head = {
      'sales-order-detail': {
        ...base['sales-order-detail'],
        'button-name': 1,
      },
    }
    const result = checkA11yBaselineRatchet(base, head)
    assert.equal(result.ok, false)
    assert.match(result.message, /button-name/)
  })

  test('Scenario 4c: fails when a PR raises a baselined count', () => {
    const head = {
      'sales-order-detail': {
        'color-contrast': 3,
        region: 1,
      },
    }
    const result = checkA11yBaselineRatchet(base, head)
    assert.equal(result.ok, false)
    assert.match(result.message, /color-contrast/)
  })

  test('Scenario 4d: passes when a PR removes a rule or lowers a count', () => {
    const head = {
      'sales-order-detail': {
        'color-contrast': 1,
      },
    }
    const result = checkA11yBaselineRatchet(base, head)
    assert.equal(result.ok, true, result.message)
  })
})

describe('A11y baseline ratchet against base branch', () => {
  test('committed a11y-baseline.json does not grow compared to base branch', () => {
    assert.ok(existsSync(baselinePath), 'missing apps/core-web/e2e-fullstack/a11y-baseline.json')
    const headBaseline = JSON.parse(readFileSync(baselinePath, 'utf8'))

    const baseRef = process.env.A11Y_BASELINE_BASE_REF || 'origin/main'
    let baseRaw = null
    try {
      baseRaw = execFileSync(
        'git',
        ['show', `${baseRef}:apps/core-web/e2e-fullstack/a11y-baseline.json`],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
    } catch {
      // Base branch does not have a11y-baseline.json yet (initial introduction PR).
      baseRaw = null
    }

    if (baseRaw !== null) {
      const baseBaseline = JSON.parse(baseRaw)
      const result = checkA11yBaselineRatchet(baseBaseline, headBaseline)
      assert.equal(result.ok, true, result.message)
    }
  })
})

describe('A11y anti-criteria static checks', () => {
  test('helper and fullstack specs do not disable rules, exclude root elements, or drop A11Y_AXE_TAGS', () => {
    const filesToCheck = [
      checkpointHelperPath,
      ...readdirSync(fullstackDir)
        .filter((name) => name.endsWith('.spec.ts'))
        .map((name) => resolve(fullstackDir, name)),
    ]

    for (const filePath of filesToCheck) {
      const source = readFileSync(filePath, 'utf8')
      assert.doesNotMatch(
        source,
        /\bdisableRules\b/,
        `${filePath} must not call disableRules`,
      )
      assert.doesNotMatch(
        source,
        /\.exclude\s*\(\s*['"`](?:body|html|#root)['"`]/,
        `${filePath} must not exclude body, html, or #root`,
      )
    }

    const helperSource = readFileSync(checkpointHelperPath, 'utf8')
    assert.match(
      helperSource,
      /\bA11Y_AXE_TAGS\b/,
      'a11y-checkpoint.ts must reuse A11Y_AXE_TAGS from e2e/utils/a11y.ts',
    )

    const a11yUtilsSource = readFileSync(mockedA11yUtilsPath, 'utf8')
    for (const requiredTag of ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']) {
      assert.match(
        a11yUtilsSource,
        new RegExp(`['"]${requiredTag}['"]`),
        `A11Y_AXE_TAGS in e2e/utils/a11y.ts must include ${requiredTag}`,
      )
    }
  })

  test('a11y-baseline.json contains no wildcard keys', () => {
    assert.ok(existsSync(baselinePath), 'missing apps/core-web/e2e-fullstack/a11y-baseline.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    for (const [checkpointId, rules] of Object.entries(baseline)) {
      assert.doesNotMatch(checkpointId, /[*?]/, `wildcard checkpoint key not allowed: ${checkpointId}`)
      for (const ruleId of Object.keys(rules)) {
        assert.doesNotMatch(ruleId, /[*?]/, `wildcard rule key not allowed: ${ruleId}`)
      }
    }
  })

  test('A11Y_ALLOWLIST in e2e/utils/a11y.ts stays empty', () => {
    const a11yUtilsSource = readFileSync(mockedA11yUtilsPath, 'utf8')
    assert.match(
      a11yUtilsSource,
      /export const A11Y_ALLOWLIST[\s\S]*?=\s*\[\s*\]\s*;/,
      'A11Y_ALLOWLIST in e2e/utils/a11y.ts must remain empty',
    )
  })

  test('every key in a11y-baseline.json is registered in a11y-checkpoint-paths.ts', () => {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    const checkpointPathsSource = readFileSync(checkpointPathsPath, 'utf8')
    for (const checkpointId of Object.keys(baseline)) {
      assert.match(
        checkpointPathsSource,
        new RegExp(`['"]${checkpointId}['"]\\s*:`),
        `checkpoint "${checkpointId}" in a11y-baseline.json must be registered in a11y-checkpoint-paths.ts`,
      )
    }
  })

  test('every key in A11Y_FULLSTACK_CHECKPOINT_PATHS is passed to scanA11y under e2e-fullstack', () => {
    const checkpointPathsSource = readFileSync(checkpointPathsPath, 'utf8')
    const checkpointIds = [...checkpointPathsSource.matchAll(/['"]([^'"]+)['"]\s*:/g)].map((m) => m[1])
    assert.ok(checkpointIds.length > 0, 'expected at least one checkpoint in a11y-checkpoint-paths.ts')

    const fullstackSource = readdirSync(fullstackDir)
      .filter(
        (name) =>
          name.endsWith('.ts') &&
          name !== 'a11y-checkpoint.ts' &&
          name !== 'a11y-checkpoint-paths.ts',
      )
      .map((name) => readFileSync(resolve(fullstackDir, name), 'utf8'))
      .join('\n')

    for (const checkpointId of checkpointIds) {
      const escaped = checkpointId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      assert.match(
        fullstackSource,
        new RegExp(`\\bscanA11y\\s*\\([^)]*,\\s*['"]${escaped}['"]\\s*\\)`),
        `checkpoint "${checkpointId}" in a11y-checkpoint-paths.ts must be passed to scanA11y under e2e-fullstack`,
      )
    }
  })
})

describe('checkA11yRouteExceptionsRatchet (AUT-1016)', () => {
  const base = {
    '/hr': 'not yet covered, AUT-1006 follow-up',
    '/dashboard': 'not yet covered, AUT-1006 follow-up',
  }

  test('Scenario 5a: fails when a PR adds a key to the exception file versus base', () => {
    const head = {
      ...base,
      '/new-route': 'not yet covered, AUT-1006 follow-up',
    }
    const result = checkA11yRouteExceptionsRatchet(base, head)
    assert.equal(result.ok, false)
    assert.match(result.message, /\/new-route/)
  })

  test('Scenario 5b: passes when a PR removes a key from the exception file versus base', () => {
    const head = {
      '/hr': 'not yet covered, AUT-1006 follow-up',
    }
    const result = checkA11yRouteExceptionsRatchet(base, head)
    assert.equal(result.ok, true, result.message)
  })
})

describe('A11y route exceptions ratchet against base branch (AUT-1016)', () => {
  test('committed a11y-route-exceptions.json does not add keys compared to base branch', () => {
    assert.ok(existsSync(routeExceptionsPath), 'missing apps/core-web/e2e/a11y-route-exceptions.json')
    const headExceptions = JSON.parse(readFileSync(routeExceptionsPath, 'utf8'))

    const baseRef = process.env.A11Y_BASELINE_BASE_REF || 'origin/main'
    let baseRaw = null
    try {
      baseRaw = execFileSync(
        'git',
        ['show', `${baseRef}:apps/core-web/e2e/a11y-route-exceptions.json`],
        { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      )
    } catch {
      // Base branch does not have a11y-route-exceptions.json yet (initial introduction PR).
      baseRaw = null
    }

    if (baseRaw !== null) {
      const baseExceptions = JSON.parse(baseRaw)
      const result = checkA11yRouteExceptionsRatchet(baseExceptions, headExceptions)
      assert.equal(result.ok, true, result.message)
    }
  })
})

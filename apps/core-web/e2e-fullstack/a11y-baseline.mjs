function formatSelectors(nodes) {
  return nodes
    .map((node) => (Array.isArray(node.target) ? node.target.join(' ') : String(node.target)))
    .join(', ')
}

export function compareA11yViolationsToBaseline({
  checkpointId,
  pathname,
  violations,
  baseline,
}) {
  const checkpointBaseline = baseline[checkpointId] ?? {}
  const errors = []
  const seenCounts = new Map()

  for (const violation of violations) {
    const actualCount = violation.nodes.length
    seenCounts.set(violation.id, actualCount)
    const baselinedCount = checkpointBaseline[violation.id]

    if (baselinedCount === undefined || actualCount > baselinedCount) {
      const expected = baselinedCount === undefined ? 0 : baselinedCount
      errors.push(
        `- Rule "${violation.id}" (impact: ${violation.impact ?? 'unknown'}) has ${actualCount} violation(s) (baselined: ${expected})\n` +
          `  Help: ${violation.helpUrl}\n` +
          `  Selectors: ${formatSelectors(violation.nodes)}`,
      )
    }
  }

  for (const [ruleId, baselinedCount] of Object.entries(checkpointBaseline)) {
    const actualCount = seenCounts.get(ruleId) ?? 0
    if (actualCount < baselinedCount) {
      errors.push(
        `- Rule "${ruleId}" has ${actualCount} violation(s) (baselined: ${baselinedCount}) — remove from baseline`,
      )
    }
  }

  if (errors.length === 0) {
    return { ok: true, errors: [], message: '' }
  }

  return {
    ok: false,
    errors,
    message: `[a11y] checkpoint "${checkpointId}" (${pathname}):\n${errors.join('\n')}`,
  }
}

export function checkA11yBaselineRatchet(baseBaseline, headBaseline) {
  const errors = []

  for (const [checkpointId, headRules] of Object.entries(headBaseline)) {
    const baseRules = baseBaseline[checkpointId]
    if (!baseRules) {
      errors.push(`Baseline adds checkpoint "${checkpointId}"`)
      continue
    }

    for (const [ruleId, headCount] of Object.entries(headRules)) {
      const baseCount = baseRules[ruleId]
      if (baseCount === undefined) {
        errors.push(`Baseline adds rule "${ruleId}" on checkpoint "${checkpointId}"`)
      } else if (typeof headCount !== 'number' || !Number.isInteger(headCount) || headCount < 0) {
        errors.push(`Baseline has invalid count for "${checkpointId}.${ruleId}": ${headCount}`)
      } else if (headCount > baseCount) {
        errors.push(
          `Baseline raises "${checkpointId}.${ruleId}" from ${baseCount} to ${headCount}`,
        )
      }
    }
  }

  if (errors.length === 0) {
    return { ok: true, errors: [], message: '' }
  }

  return {
    ok: false,
    errors,
    message: `A11y baseline ratchet failed:\n${errors.map((e) => `- ${e}`).join('\n')}`,
  }
}

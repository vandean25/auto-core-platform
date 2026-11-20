// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(import.meta.dirname, '../../..')
const workflowPath = resolve(repoRoot, '.github/workflows/ui-visual.yaml')
const workflow = readFileSync(workflowPath, 'utf8')

type StepBlock = {
  name: string
  body: string
}

function extractSteps(yamlText: string): StepBlock[] {
  const stepsIndex = yamlText.indexOf('\n    steps:\n')
  if (stepsIndex === -1) {
    throw new Error('Could not find steps: block in ui-visual.yaml')
  }
  const stepsSection = yamlText.slice(stepsIndex + '\n    steps:\n'.length)
  const stepChunks = stepsSection.split(/\n {6}- name:\s*/).filter(Boolean)

  return stepChunks.map((chunk) => {
    const normalized = chunk.replace(/^\s*- name:\s*/, '')
    const newlineIdx = normalized.indexOf('\n')
    const name = (newlineIdx === -1 ? normalized : normalized.slice(0, newlineIdx)).trim()
    const body = newlineIdx === -1 ? '' : normalized.slice(newlineIdx + 1)
    return { name, body }
  })
}

function extractOnBlock(yamlText: string): string {
  const match = yamlText.match(/^on:\n([\s\S]*?)^\S/m)
  if (!match) {
    throw new Error('Could not find on: trigger block in ui-visual.yaml')
  }
  return match[1]
}

describe('.github/workflows/ui-visual.yaml', () => {
  const steps = extractSteps(workflow)
  const jobHeader = workflow.slice(0, workflow.indexOf('\n    steps:\n'))

  it('does not set continue-on-error at job level so setup/install failures still fail the check', () => {
    expect(jobHeader).not.toMatch(/^\s*continue-on-error\s*:/m)
  })

  it('sets continue-on-error only on the compare step (id: compare) and on no other step', () => {
    const stepsWithContinueOnError = steps.filter((step) => /^\s*continue-on-error\s*:/m.test(step.body))
    expect(stepsWithContinueOnError).toHaveLength(1)

    const [compareStep] = stepsWithContinueOnError
    expect(compareStep.name).toBe('Compare screenshots with the baselines')
    expect(compareStep.body).toMatch(/^\s*id:\s*compare\b/m)
    expect(compareStep.body).toMatch(/^\s*continue-on-error:\s*true\b/m)

    for (const requiredStepName of ['Checkout', 'Setup Node', 'Install workspace dependencies']) {
      const step = steps.find((s) => s.name === requiredStepName)
      expect(step, `Expected step "${requiredStepName}" to exist`).toBeDefined()
      expect(step!.body).not.toMatch(/^\s*continue-on-error\s*:/m)
    }
  })

  it('triggers only on pull_request and workflow_dispatch (never push)', () => {
    const onBlock = extractOnBlock(workflow)
    expect(onBlock).toMatch(/^\s{2}pull_request:/m)
    expect(onBlock).toMatch(/^\s{2}workflow_dispatch:/m)
    expect(onBlock).not.toMatch(/^\s{2}push:/m)
    expect(onBlock).toMatch(/^\s{6}update_baselines:/m)
    expect(onBlock).toMatch(/^\s{8}type:\s*boolean\b/m)
    expect(onBlock).toMatch(/^\s{8}default:\s*false\b/m)
  })

  it('gates baseline regeneration and upload strictly on workflow_dispatch with update_baselines', () => {
    const baselineSteps = [
      'Regenerate visual baselines',
      'Upload regenerated visual baselines',
      'Link the regenerated baselines artifact in the job summary',
    ]

    for (const stepName of baselineSteps) {
      const step = steps.find((s) => s.name === stepName)
      expect(step, `Expected step "${stepName}" to exist`).toBeDefined()
      expect(step!.body).toMatch(
        /^\s*if:\s*\$\{\{\s*github\.event_name == 'workflow_dispatch' && inputs\.update_baselines\s*\}\}/m,
      )
    }
  })

  it('keeps permissions read-only and surfaces visual diffs via summary warning and ui-visual-diff artifact', () => {
    expect(workflow).toMatch(/^permissions:\n\s+contents:\s*read\b/m)

    const uploadDiff = steps.find((s) => s.name === 'Upload expected, actual and diff images')
    const linkDiff = steps.find((s) => s.name === 'Link the diff artifact in the job summary')
    expect(uploadDiff?.body).toMatch(/^\s*if:\s*\$\{\{\s*steps\.compare\.outcome == 'failure'\s*\}\}/m)
    expect(uploadDiff?.body).toMatch(/^\s*name:\s*ui-visual-diff\b/m)
    expect(linkDiff?.body).toMatch(/^\s*if:\s*\$\{\{\s*steps\.compare\.outcome == 'failure'\s*\}\}/m)
    expect(linkDiff?.body).toContain('$GITHUB_STEP_SUMMARY')
    expect(linkDiff?.body).toContain('::warning::')
  })
})

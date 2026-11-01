import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import { ENTITY_ACTION_IDS } from './entity-action'
import { createWorkshopCommandActions } from './workshop-command-actions'

describe('workshop-command-actions', () => {
  const t = ((key: string) => key) as TFunction<'workshop'>
  const definitions = createWorkshopCommandActions(t)

  it('exposes all workshopCommand action IDs', () => {
    const ids = definitions.map((action) => action.id)
    expect(ids).toEqual([
      ENTITY_ACTION_IDS.workshopCommandApply,
      ENTITY_ACTION_IDS.workshopCommandApplyNow,
      ENTITY_ACTION_IDS.workshopCommandReview,
      ENTITY_ACTION_IDS.workshopCommandDictate,
      ENTITY_ACTION_IDS.workshopCommandEdit,
      ENTITY_ACTION_IDS.workshopCommandReset,
      ENTITY_ACTION_IDS.workshopCommandChoose,
      ENTITY_ACTION_IDS.workshopCommandOpenOrders,
      ENTITY_ACTION_IDS.workshopCommandExit,
    ])
  })

  it('restricts apply and applyNow to OWNER and ADMIN', () => {
    const applyAction = definitions.find((a) => a.id === ENTITY_ACTION_IDS.workshopCommandApply)!
    const applyNowAction = definitions.find((a) => a.id === ENTITY_ACTION_IDS.workshopCommandApplyNow)!

    expect(applyAction.isAllowedForRole('OWNER')).toBe(true)
    expect(applyAction.isAllowedForRole('ADMIN')).toBe(true)
    expect(applyAction.isAllowedForRole('SALES')).toBe(false)
    expect(applyAction.isAllowedForRole('TECH')).toBe(false)

    expect(applyNowAction.isAllowedForRole('OWNER')).toBe(true)
    expect(applyNowAction.isAllowedForRole('ADMIN')).toBe(true)
    expect(applyNowAction.isAllowedForRole('SALES')).toBe(false)
    expect(applyNowAction.isAllowedForRole('TECH')).toBe(false)
  })

  it('allows command mode review actions for OWNER, ADMIN, and SALES', () => {
    const reviewAction = definitions.find((a) => a.id === ENTITY_ACTION_IDS.workshopCommandReview)!
    const dictateAction = definitions.find((a) => a.id === ENTITY_ACTION_IDS.workshopCommandDictate)!

    for (const role of ['OWNER', 'ADMIN', 'SALES']) {
      expect(reviewAction.isAllowedForRole(role)).toBe(true)
      expect(dictateAction.isAllowedForRole(role)).toBe(true)
    }
    for (const role of ['TECH', 'MECHANIC', 'SERVICE_ADVISOR', 'DEMO']) {
      expect(reviewAction.isAllowedForRole(role)).toBe(false)
      expect(dictateAction.isAllowedForRole(role)).toBe(false)
    }
  })

  it('runs action handlers from context', async () => {
    const record = { commandId: 'c1' }
    const apply = vi.fn()
    const applyNow = vi.fn()
    const applyAction = definitions.find((a) => a.id === ENTITY_ACTION_IDS.workshopCommandApply)!
    const applyNowAction = definitions.find((a) => a.id === ENTITY_ACTION_IDS.workshopCommandApplyNow)!

    await applyAction.run(record, { apply })
    expect(apply).toHaveBeenCalled()

    await applyNowAction.run(record, { applyNow })
    expect(applyNow).toHaveBeenCalled()
  })

  it('maps choose and reset labels to command.choose and command.reset', () => {
    const resetAction = definitions.find((a) => a.id === ENTITY_ACTION_IDS.workshopCommandReset)!
    const chooseAction = definitions.find((a) => a.id === ENTITY_ACTION_IDS.workshopCommandChoose)!
    expect(resetAction.label).toBe('command.reset')
    expect(chooseAction.label).toBe('command.choose')
  })
})

import { describe, expect, it } from 'vitest'
import { canManageWorkshopEstimates, isWorkshopEstimateOrderOpen } from './workshop-estimate-permissions'

describe('canManageWorkshopEstimates', () => {
  it.each(['OWNER', 'ADMIN', 'SALES'])('lets %s create, revise and send', (role) => {
    expect(canManageWorkshopEstimates(role)).toBe(true)
  })

  it.each(['TECH', 'UNKNOWN'])('gives %s no estimate controls', (role) => {
    expect(canManageWorkshopEstimates(role)).toBe(false)
  })

  it('gives no controls while the session role is not loaded', () => {
    expect(canManageWorkshopEstimates(undefined)).toBe(false)
    expect(canManageWorkshopEstimates(null)).toBe(false)
  })
})

describe('isWorkshopEstimateOrderOpen', () => {
  it.each(['INTAKE', 'IN_PROGRESS'])('treats %s as open for estimates', (status) => {
    expect(isWorkshopEstimateOrderOpen(status)).toBe(true)
  })

  it.each(['SCHEDULED', 'COMPLETED', 'INVOICED'])('treats %s as closed for estimates', (status) => {
    expect(isWorkshopEstimateOrderOpen(status)).toBe(false)
  })
})

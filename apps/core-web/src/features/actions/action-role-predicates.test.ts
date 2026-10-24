import { describe, expect, it } from 'vitest'

import {
  canAssignWorkshopOrderMechanic,
  canCheckInWorkshopOrder,
  canDeleteCustomerFromList,
  canGenerateWorkshopJobCardPdf,
  canOpenCustomer,
  canOpenVehicle,
  canOpenWorkshopOrder,
  canUpdateWorkshopOrderTaskState,
  isWorkshopCheckInOpenStatus,
  isWorkshopOrderLockedStatus,
  isWorkshopTechAssignableStatus,
} from './action-role-predicates'

describe('action-role-predicates', () => {
  it('allows standard roles for customer, vehicle and workshop order actions', () => {
    expect(canOpenCustomer('ADMIN')).toBe(true)
    expect(canDeleteCustomerFromList('MECHANIC')).toBe(true)
    expect(canOpenVehicle('SALES')).toBe(true)
    expect(canOpenWorkshopOrder('ADMIN')).toBe(true)
    expect(canCheckInWorkshopOrder('SERVICE_ADVISOR')).toBe(true)
    expect(canGenerateWorkshopJobCardPdf('OWNER')).toBe(true)
    expect(canAssignWorkshopOrderMechanic('ADMIN')).toBe(true)
    expect(canUpdateWorkshopOrderTaskState('TECH')).toBe(true)

    expect(canOpenCustomer('')).toBe(false)
    expect(canDeleteCustomerFromList('')).toBe(false)
    expect(canOpenVehicle('')).toBe(false)
    expect(canOpenWorkshopOrder('')).toBe(false)
    expect(canCheckInWorkshopOrder('')).toBe(false)
    expect(canGenerateWorkshopJobCardPdf('')).toBe(false)
    expect(canAssignWorkshopOrderMechanic('')).toBe(false)
    expect(canUpdateWorkshopOrderTaskState('')).toBe(false)
  })

  it('evaluates workshop order status predicates consistently', () => {
    expect(isWorkshopCheckInOpenStatus('INTAKE')).toBe(true)
    expect(isWorkshopCheckInOpenStatus('IN_PROGRESS')).toBe(true)
    expect(isWorkshopCheckInOpenStatus('SCHEDULED')).toBe(false)
    expect(isWorkshopCheckInOpenStatus('COMPLETED')).toBe(false)
    expect(isWorkshopCheckInOpenStatus('INVOICED')).toBe(false)

    expect(isWorkshopTechAssignableStatus('SCHEDULED')).toBe(true)
    expect(isWorkshopTechAssignableStatus('INTAKE')).toBe(true)
    expect(isWorkshopTechAssignableStatus('IN_PROGRESS')).toBe(true)
    expect(isWorkshopTechAssignableStatus('COMPLETED')).toBe(false)
    expect(isWorkshopTechAssignableStatus('INVOICED')).toBe(false)

    expect(isWorkshopOrderLockedStatus('INVOICED')).toBe(true)
    expect(isWorkshopOrderLockedStatus('IN_PROGRESS')).toBe(false)
  })
})

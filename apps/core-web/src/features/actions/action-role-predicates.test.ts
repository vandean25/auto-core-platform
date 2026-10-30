import { describe, expect, it } from 'vitest'

import {
  canAssignWorkshopOrderMechanic,
  canCheckInWorkshopOrder,
  canDeleteCustomerFromList,
  canGenerateWorkshopJobCardPdf,
  canOpenCustomer,
  canOpenEstimate,
  canOpenVehicle,
  canOpenWorkshopOrder,
  canRecordTyreMeasurement,
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

  it('limits the estimates list to the roles that manage estimates', () => {
    for (const role of ['OWNER', 'ADMIN', 'SALES']) {
      expect(canOpenEstimate(role)).toBe(true)
    }
    for (const role of ['TECH', 'MECHANIC', '', undefined]) {
      expect(canOpenEstimate(role)).toBe(false)
    }
  })

  it.each([
    ['OWNER', true], ['ADMIN', true], ['SALES', true], ['TECH', true],
    ['ACCOUNTANT', false], ['SERVICE_ADVISOR', false], ['MECHANIC', false],
    ['SUPER_ADMIN', false], ['owner', false], ['', false], [null, false], [undefined, false],
  ] as const)('allows tyre measurement only for authorized roles (%s)', (role, expected) => {
    expect(canRecordTyreMeasurement(role)).toBe(expected)
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

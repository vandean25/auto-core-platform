import { describe, expect, it } from 'vitest'

import {
  canApplyWorkshopCommand,
  canAssignWorkshopOrderMechanic,
  canManageImportJobs,
  canManageWorkshopTasks,
  canCheckInWorkshopOrder,
  canDeleteCustomerFromList,
  canDeleteSalesOrder,
  isSalesOrderDraftDeletable,
  canGenerateWorkshopJobCardPdf,
  canOpenBackOfficeDetail,
  canOpenCustomer,
  canOpenEstimate,
  canOpenVehicle,
  canOpenWorkshopOrder,
  canRecordTyreMeasurement,
  canUseWorkshopCommand,
  isWorkshopCheckInOpenStatus,
  isWorkshopOrderLockedStatus,
  isWorkshopTechAssignableStatus,
} from './action-role-predicates'

describe('action-role-predicates', () => {
  it('limits sales order delete to back-office roles and draft orders without an invoice', () => {
    expect(canDeleteSalesOrder('SALES')).toBe(true)
    expect(canDeleteSalesOrder('TECH')).toBe(false)
    expect(isSalesOrderDraftDeletable({ status: 'DRAFT', invoice: null })).toBe(true)
    expect(isSalesOrderDraftDeletable({ status: 'CONFIRMED', invoice: null })).toBe(false)
    expect(isSalesOrderDraftDeletable({ status: 'DRAFT', invoice: { id: 'inv-1' } })).toBe(false)
  })

  it('allows standard roles for customer, vehicle and workshop order actions', () => {
    expect(canOpenCustomer('ADMIN')).toBe(true)
    expect(canDeleteCustomerFromList('MECHANIC')).toBe(true)
    expect(canOpenVehicle('SALES')).toBe(true)
    expect(canOpenWorkshopOrder('ADMIN')).toBe(true)
    expect(canCheckInWorkshopOrder('SERVICE_ADVISOR')).toBe(true)
    expect(canGenerateWorkshopJobCardPdf('OWNER')).toBe(true)
    expect(canAssignWorkshopOrderMechanic('ADMIN')).toBe(true)

    expect(canOpenCustomer('')).toBe(false)
    expect(canDeleteCustomerFromList('')).toBe(false)
    expect(canOpenVehicle('')).toBe(false)
    expect(canOpenWorkshopOrder('')).toBe(false)
    expect(canCheckInWorkshopOrder('')).toBe(false)
    expect(canGenerateWorkshopJobCardPdf('')).toBe(false)
    expect(canAssignWorkshopOrderMechanic('')).toBe(false)
    expect(canOpenBackOfficeDetail('ADMIN')).toBe(true)
    expect(canOpenBackOfficeDetail('SALES')).toBe(true)
    expect(canOpenBackOfficeDetail('OWNER')).toBe(true)
    expect(canOpenBackOfficeDetail(undefined)).toBe(true)
    expect(canOpenBackOfficeDetail('TECH')).toBe(false)
    expect(canOpenBackOfficeDetail('')).toBe(false)
  })

  it.each([
    ['OWNER', true], ['ADMIN', true], ['SALES', true], ['DEMO', true],
    ['TECH', false], ['MECHANIC', false],
    ['SERVICE_ADVISOR', false], ['owner', false], ['', false], [null, false], [undefined, false],
  ] as const)('gates workshop task writes to back-office roles plus demo (%s: %s)', (role, expected) => {
    expect(canManageWorkshopTasks(role)).toBe(expected)
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
    ['OWNER', true], ['ADMIN', true], ['SALES', true],
    ['TECH', false], ['MECHANIC', false], ['SERVICE_ADVISOR', false],
    ['ACCOUNTANT', false], ['SUPER_ADMIN', false], ['DEMO', false],
    ['owner', false], ['', false], [null, false], [undefined, false],
  ] as const)('opens the command mode only for authorized roles (%s: %s)', (role, expected) => {
    expect(canUseWorkshopCommand(role)).toBe(expected)
  })

  it.each([
    ['OWNER', true], ['ADMIN', true],
    ['SALES', false], ['TECH', false], ['MECHANIC', false], ['SERVICE_ADVISOR', false],
    ['ACCOUNTANT', false], ['SUPER_ADMIN', false], ['DEMO', false],
    ['owner', false], ['', false], [null, false], [undefined, false],
  ] as const)('allows workshop command apply only for supervisor roles (%s: %s)', (role, expected) => {
    expect(canApplyWorkshopCommand(role)).toBe(expected)
  })

  it.each([
    ['OWNER', true], ['ADMIN', true], ['SALES', true], ['TECH', true],
    ['ACCOUNTANT', false], ['SERVICE_ADVISOR', false], ['MECHANIC', false],
    ['SUPER_ADMIN', false], ['owner', false], ['', false], [null, false], [undefined, false],
  ] as const)('allows tyre measurement only for authorized roles (%s)', (role, expected) => {
    expect(canRecordTyreMeasurement(role)).toBe(expected)
  })

  it.each([
    ['OWNER', true], ['ADMIN', true],
    ['SALES', false], ['TECH', false], ['ACCOUNTANT', false],
    ['SERVICE_ADVISOR', false], ['MECHANIC', false], ['DEMO', false],
    ['SUPER_ADMIN', false], ['owner', false], ['', false], [null, false], [undefined, false],
  ] as const)('allows import job actions only for tenant admins (%s)', (role, expected) => {
    expect(canManageImportJobs(role)).toBe(expected)
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

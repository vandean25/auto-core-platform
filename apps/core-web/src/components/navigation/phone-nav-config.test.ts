import { describe, expect, it } from 'vitest'
import { getPhoneNavDestinations, getPhoneNavVariant, PHONE_NAV_LAYOUTS } from './phone-nav-config'

const ids = (activeRole: Parameters<typeof getPhoneNavDestinations>[0]['activeRole']) =>
  getPhoneNavDestinations({ platformRole: null, activeRole }).map((item) => item.id)

describe('phone bottom navigation per role', () => {
  it('mechanic (TECH): no sidebar destinations, + Finding in the centre', () => {
    expect(getPhoneNavVariant('TECH')).toBe('mechanic')
    expect(PHONE_NAV_LAYOUTS.mechanic.create).toBe('finding')
    expect(ids('TECH')).toEqual([])
  })

  it('service advisor: Orders, Appointments (planner), + New', () => {
    for (const role of ['SALES', 'ADVISOR'] as const) {
      expect(getPhoneNavVariant(role)).toBe('advisor')
    }
    expect(PHONE_NAV_LAYOUTS.advisor.create).toBe('new')
    expect(ids('SALES')).toEqual(['workshop-orders', 'workshop-planner'])
  })

  it('other roles: Dashboard, Orders, + New', () => {
    for (const role of ['OWNER', 'ADMIN', 'DEMO', null] as const) {
      expect(getPhoneNavVariant(role)).toBe('default')
    }
    expect(PHONE_NAV_LAYOUTS.default.create).toBe('new')
    expect(ids('OWNER')).toEqual(['dashboard', 'workshop-orders'])
    expect(ids('ADMIN')).toEqual(['dashboard', 'workshop-orders'])
  })

  it('takes labels, links and active rules from the sidebar config', () => {
    const [orders, planner] = getPhoneNavDestinations({ platformRole: null, activeRole: 'SALES' })
    expect(orders.to).toBe('/workshop/orders')
    expect(orders.isActive('/workshop/intake', '')).toBe(true)
    expect(planner.to).toBe('/workshop/planner')
    expect(planner.labelKey).toBe('modules.workshopPlanner')
    expect([orders.phoneLabelKey, planner.phoneLabelKey]).toEqual(['phoneNav.orders', 'phoneNav.appointments'])
  })
})

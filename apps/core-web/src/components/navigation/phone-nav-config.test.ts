import { describe, expect, it } from 'vitest'
import { getPhoneNavDestinations, getPhoneNavVariant } from './phone-nav-config'

const ids = (activeRole: Parameters<typeof getPhoneNavDestinations>[0]['activeRole']) =>
  getPhoneNavDestinations({ platformRole: null, activeRole }).map((item) => item.id)

describe('phone bottom navigation destinations per role', () => {
  it('service advisor: Orders, Appointments (planner)', () => {
    expect(getPhoneNavVariant('SALES')).toBe('advisor')
    expect(ids('SALES')).toEqual(['workshop-orders', 'workshop-planner'])
  })

  it('other roles: Dashboard, Orders', () => {
    for (const role of ['OWNER', 'ADMIN', 'DEMO', null] as const) {
      expect(getPhoneNavVariant(role)).toBe('default')
    }
    expect(ids('OWNER')).toEqual(['dashboard', 'workshop-orders'])
    expect(ids('ADMIN')).toEqual(['dashboard', 'workshop-orders'])
  })

  it('takes links and active rules from the sidebar config and short labels for the bar', () => {
    const [orders, planner] = getPhoneNavDestinations({ platformRole: null, activeRole: 'SALES' })
    expect(orders.to).toBe('/workshop/orders')
    expect(orders.isActive('/workshop/intake', '')).toBe(true)
    expect(planner.to).toBe('/workshop/planner')
    expect([orders.phoneLabelKey, planner.phoneLabelKey]).toEqual(['phoneNav.orders', 'phoneNav.appointments'])
  })
})

import { describe, expect, it } from 'vitest'
import { planPushLinkStep, readPushLinkContext, stripPushLinkContext } from './push-deep-link'

describe('push link context', () => {
  it('reads the tenant and site from the link, and nothing from an ordinary address', () => {
    expect(readPushLinkContext('?pushTenant=t1&pushSite=s1')).toEqual({ tenantId: 't1', siteId: 's1' })
    expect(readPushLinkContext('?pushTenant=t1')).toEqual({ tenantId: 't1', siteId: null })
    expect(readPushLinkContext('?tab=notes')).toBeNull()
    expect(readPushLinkContext('')).toBeNull()
  })

  it('removes only the two hint parameters', () => {
    expect(
      stripPushLinkContext({ pathname: '/workshop/orders/o1', search: '?pushTenant=t1&tab=notes&pushSite=s1', hash: '#x' }),
    ).toBe('/workshop/orders/o1?tab=notes#x')
    expect(stripPushLinkContext({ pathname: '/workshop/orders/o1', search: '?pushTenant=t1', hash: '' })).toBe(
      '/workshop/orders/o1',
    )
  })

  describe('planPushLinkStep', () => {
    const base = { activeTenantId: 't1', activeSiteId: 's-b', siteIds: ['s-a', 's-b'] }

    it('switches the tenant first, because the sites listed belong to the active tenant', () => {
      expect(planPushLinkStep({ ...base, context: { tenantId: 't2', siteId: 's-a' } })).toBe('switch-tenant')
    })

    it('switches to the site of the order when the user works in another one (cross-site click)', () => {
      expect(planPushLinkStep({ ...base, context: { tenantId: 't1', siteId: 's-a' } })).toBe('switch-site')
    })

    it('waits for the list of sites before it decides', () => {
      expect(planPushLinkStep({ ...base, siteIds: null, context: { tenantId: 't1', siteId: 's-a' } })).toBe('wait-sites')
    })

    it('refuses a site the user may not work in, and never trusts the link for it', () => {
      expect(planPushLinkStep({ ...base, context: { tenantId: 't1', siteId: 's-evil' } })).toBe('refuse-site')
    })

    it('is done when tenant and site already match, or the link names no site', () => {
      expect(planPushLinkStep({ ...base, context: { tenantId: 't1', siteId: 's-b' } })).toBe('done')
      expect(planPushLinkStep({ ...base, context: { tenantId: 't1', siteId: null } })).toBe('done')
    })
  })
})

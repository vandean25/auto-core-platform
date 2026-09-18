import { describe, expect, it } from 'vitest'
import type { StockTransfer } from '@/api/stock-transfers'
import {
  buildMemberSiteIdSet,
  canApproveOrRejectTransfer,
  canCancelTransfer,
  canReceiveTransfer,
  canReturnTransfer,
  canShipTransfer,
  canSuggestSourceBin,
  shouldShowSourceBinDetails,
} from './stock-transfer-permissions'

const baseTransfer: StockTransfer = {
  id: 'transfer-1',
  transferNumber: 'TR-2026-0001',
  fromSiteId: 'site-from',
  fromSiteName: 'Wien',
  toSiteId: 'site-to',
  toSiteName: 'München',
  status: 'REQUESTED',
  version: 1,
  requestedByUserId: 'user-1',
  approvedByUserId: null,
  shippedByUserId: null,
  receivedByUserId: null,
  rejectReason: null,
  cancelReason: null,
  createdAt: '2026-09-17T10:00:00.000Z',
  updatedAt: '2026-09-17T10:00:00.000Z',
  lines: [],
}

describe('stock-transfer-permissions', () => {
  it('hides source-bin suggestion for destination-only members', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-to'])
    expect(canSuggestSourceBin('site-from', memberSiteIds)).toBe(false)
    expect(canCancelTransfer(baseTransfer, memberSiteIds)).toBe(true)
    expect(canApproveOrRejectTransfer(baseTransfer, memberSiteIds, 'ADMIN')).toBe(false)
  })

  it('allows from-site admins to approve and ship', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-from'])
    expect(canApproveOrRejectTransfer(baseTransfer, memberSiteIds, 'ADMIN')).toBe(true)
    expect(canShipTransfer({ ...baseTransfer, status: 'APPROVED' }, memberSiteIds)).toBe(true)
  })

  it('allows destination members to receive shipped stock', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-to'])
    expect(
      canReceiveTransfer({ ...baseTransfer, status: 'SHIPPED' }, memberSiteIds),
    ).toBe(true)
  })

  it('redacts source-bin details for destination-only viewers', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-to'])
    expect(
      shouldShowSourceBinDetails('site-from', memberSiteIds, 'bin-wien'),
    ).toBe(false)
    expect(
      shouldShowSourceBinDetails('site-from', buildMemberSiteIdSet(['site-from']), 'bin-wien'),
    ).toBe(true)
  })

  it('allows from-site admins to return unreceived stock', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-from'])
    expect(
      canReturnTransfer({ ...baseTransfer, status: 'SHIPPED' }, memberSiteIds, 'ADMIN'),
    ).toBe(true)
    expect(
      canReturnTransfer({ ...baseTransfer, status: 'SHIPPED' }, memberSiteIds, 'TECH'),
    ).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { StockTransfer } from '@/api/stock-transfers'
import {
  buildMemberSiteIdSet,
  canApproveOrRejectTransfer,
  canCancelTransfer,
  canReceiveTransfer,
  canReturnTransfer,
  canShipTransfer,
  canSubmitShip,
  canSuggestSourceBin,
  getLinesMissingShipSourceBins,
  hasReceiveMembership,
  hasShipMembership,
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
  lines: [
    {
      id: 'line-1',
      catalogItemId: 'item-1',
      requestedQty: '2.000',
      approvedQty: '2.000',
      shippedQty: '0.000',
      receivedQty: '0.000',
      returnedQty: '0.000',
      sourceLocationId: null,
      destLocationId: null,
    },
  ],
}

describe('stock-transfer-permissions', () => {
  it('hides source-bin suggestion for destination-only members', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-to'])
    expect(canSuggestSourceBin('site-from', memberSiteIds)).toBe(false)
    expect(canApproveOrRejectTransfer(baseTransfer, memberSiteIds, 'ADMIN')).toBe(false)
  })

  it('allows destination-only requester to cancel', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-to'])
    expect(canCancelTransfer(baseTransfer, memberSiteIds, 'user-1', 'TECH')).toBe(true)
  })

  it('blocks destination-only non-requester cancel', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-to'])
    expect(canCancelTransfer(baseTransfer, memberSiteIds, 'user-2', 'TECH')).toBe(false)
    expect(canCancelTransfer(baseTransfer, memberSiteIds, 'user-2', 'ADMIN')).toBe(false)
  })

  it('allows from-site admin to cancel even when not the requester', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-from'])
    expect(canCancelTransfer(baseTransfer, memberSiteIds, 'user-2', 'ADMIN')).toBe(true)
    expect(canCancelTransfer(baseTransfer, memberSiteIds, 'user-2', 'TECH')).toBe(false)
  })

  it('allows from-site admins to approve and ship on the active from site', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-from'])
    const approvedTransfer = { ...baseTransfer, status: 'APPROVED' as const }
    expect(canApproveOrRejectTransfer(baseTransfer, memberSiteIds, 'ADMIN')).toBe(true)
    expect(hasShipMembership(approvedTransfer, memberSiteIds)).toBe(true)
    expect(canShipTransfer(approvedTransfer, memberSiteIds, 'site-from')).toBe(true)
    expect(canShipTransfer(approvedTransfer, memberSiteIds, 'site-to')).toBe(false)
  })

  it('allows destination members to receive only on the active to site', () => {
    const memberSiteIds = buildMemberSiteIdSet(['site-to'])
    const shippedTransfer = { ...baseTransfer, status: 'SHIPPED' as const }
    expect(hasReceiveMembership(shippedTransfer, memberSiteIds)).toBe(true)
    expect(canReceiveTransfer(shippedTransfer, memberSiteIds, 'site-to')).toBe(true)
    expect(canReceiveTransfer(shippedTransfer, memberSiteIds, 'site-from')).toBe(false)
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

  it('requires a source bin for every positive-approved line before ship', () => {
    const approvedTransfer = { ...baseTransfer, status: 'APPROVED' as const }
    expect(getLinesMissingShipSourceBins(approvedTransfer, {})).toHaveLength(1)
    expect(canSubmitShip(approvedTransfer, {})).toBe(false)
    expect(canSubmitShip(approvedTransfer, { 'line-1': 'bin-from' })).toBe(true)
  })
})

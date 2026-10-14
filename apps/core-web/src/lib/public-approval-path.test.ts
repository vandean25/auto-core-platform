import { describe, expect, it } from 'vitest'
import { isPublicApprovalPath } from './public-approval-path'

describe('isPublicApprovalPath', () => {
  it('matches the approval page in any letter case, and keeps the token out of the comparison', () => {
    expect(isPublicApprovalPath('/approve/AbC-123_x')).toBe(true)
    expect(isPublicApprovalPath('/APPROVE/AbC-123_x')).toBe(true)
    expect(isPublicApprovalPath('/Approve/token/extra')).toBe(true)
  })

  it('leaves other pages, and paths that only start like the prefix, alone', () => {
    expect(isPublicApprovalPath('/approval/token')).toBe(false)
    expect(isPublicApprovalPath('/approved/1')).toBe(false)
    expect(isPublicApprovalPath('/approver/x')).toBe(false)
    expect(isPublicApprovalPath('/approve')).toBe(false)
    expect(isPublicApprovalPath('//approve/x')).toBe(false)
    expect(isPublicApprovalPath('/workshop/orders/order-1')).toBe(false)
    expect(isPublicApprovalPath('/')).toBe(false)
  })
})

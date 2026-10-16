import { describe, expect, it } from 'vitest'
import { canManageInventoryItems } from './inventory-management-permissions'

describe('canManageInventoryItems', () => {
  it.each(['OWNER', 'ADMIN'] as const)('allows %s', (role) => {
    expect(canManageInventoryItems(role)).toBe(true)
  })

  it.each(['TECH', 'SALES', 'DEMO'] as const)('denies %s', (role) => {
    expect(canManageInventoryItems(role)).toBe(false)
  })
})

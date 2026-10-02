import { describe, expect, it } from 'vitest'
import { canRecordVehicleInspection } from './vehicle-pickerl-permissions'

describe('canRecordVehicleInspection', () => {
  it('allows OWNER, ADMIN, and SALES', () => {
    expect(canRecordVehicleInspection('OWNER')).toBe(true)
    expect(canRecordVehicleInspection('ADMIN')).toBe(true)
    expect(canRecordVehicleInspection('SALES')).toBe(true)
  })

  it('denies TECH and missing role', () => {
    expect(canRecordVehicleInspection('TECH')).toBe(false)
    expect(canRecordVehicleInspection(null)).toBe(false)
    expect(canRecordVehicleInspection(undefined)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { CHECK_IN_ZONE_IDS as API_ZONE_IDS } from '../../../../../core-api/src/workshop/workshop-check-in-zones.ts'
import { CHECK_IN_ZONE_IDS } from './check-in-zones'

describe('check-in zone contract', () => {
  it('re-exports the same zone ids as the API module', () => {
    expect([...CHECK_IN_ZONE_IDS]).toEqual([...API_ZONE_IDS])
  })
})

import { describe, expect, it } from 'vitest'
import { minutesToTime, timeToMinutes } from './quiet-hours'

describe('quiet hours conversion', () => {
  it('converts minutes after midnight to HH:mm and back', () => {
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(1320)).toBe('22:00')
    expect(minutesToTime(1439)).toBe('23:59')
    expect(minutesToTime(null)).toBe('')
    expect(timeToMinutes('06:30')).toBe(390)
    expect(timeToMinutes('23:59')).toBe(1439)
  })

  it.each(['', '24:00', '6:30', '12:60', 'ab:cd'])('refuses %j', (text) => {
    expect(timeToMinutes(text)).toBeNull()
  })
})

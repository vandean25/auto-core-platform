import { beforeAll, describe, expect, it } from 'vitest'
import { initI18n } from '@/lib/i18n'
import { getErrorMessage } from './error'

describe('pages/workshop/utils/error getErrorMessage', () => {
  beforeAll(async () => {
    await initI18n({ language: 'de' })
  })

  it('maps known wire codes to translated copy', () => {
    const error = {
      status: 409,
      data: {
        code: 'VEHICLE_HAS_ACTIVE_ORDER',
        orderId: 'wo-1',
        orderNumber: 'WO-2026-0007',
        message: 'Raw server message that should never be shown',
      },
    }

    const message = getErrorMessage(error, 'Fallback Text')
    expect(message).toBe(
      'Für dieses Fahrzeug besteht bereits ein offener Werkstattauftrag (WO-2026-0007).',
    )
    expect(message).not.toContain('Raw server message')
  })

  it('returns fallback and does not leak raw backend message from Error object', () => {
    const error = new Error('Raw server exception string')
    const message = getErrorMessage(error, 'Standardfehler')
    expect(message).toBe('Standardfehler')
    expect(message).not.toContain('Raw server exception')
  })

  it('returns fallback and does not leak raw backend message from plain object', () => {
    const error = { message: 'Raw internal failure', statusCode: 400 }
    const message = getErrorMessage(error, 'Standardfehler')
    // HTTP_400 mapped code will translate, or fallback
    expect(message).not.toContain('Raw internal failure')
  })
})

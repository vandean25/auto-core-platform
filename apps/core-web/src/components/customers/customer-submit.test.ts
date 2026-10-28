import { describe, expect, it } from 'vitest'
import { buildCustomerPayload } from './customer-submit'

describe('buildCustomerPayload', () => {
  it('does not send read-only legacy numbers back when editing a customer', () => {
    const formData = {
      first_name: 'Mira',
      last_name: 'Example',
      email: ' mira@example.test ',
      legacy_ids: [{ source_system: 'legacy_system:company_a', external_id: '00123' }],
    }

    const payload = buildCustomerPayload(formData)

    expect(payload).not.toHaveProperty('legacy_ids')
    expect(payload).toMatchObject({ first_name: 'Mira', email: 'mira@example.test' })
  })
})

import { describe, expect, it } from 'vitest'

import { CUSTOMER_IMPORT_FIELDS } from './import-field-labels'
import {
  suggestColumnMapping,
  validateRequiredMappings,
} from './import-mapping-suggest'

describe('import mapping suggest', () => {
  it('auto-suggests German and English customer headers', () => {
    const headers = ['Kunden-Nr', 'Vorname', 'Last Name', 'E-Mail', 'UID']
    const mapping = suggestColumnMapping(headers, CUSTOMER_IMPORT_FIELDS)

    expect(mapping.external_id).toBe('Kunden-Nr')
    expect(mapping.first_name).toBe('Vorname')
    expect(mapping.last_name).toBe('Last Name')
    expect(mapping.email).toBe('E-Mail')
    expect(mapping.vat_id).toBe('UID')
  })

  it('flags missing required fields', () => {
    const missing = validateRequiredMappings({}, CUSTOMER_IMPORT_FIELDS)
    expect(missing).toEqual(['external_id'])

    const ok = validateRequiredMappings({ external_id: 'Kunden-Nr' }, CUSTOMER_IMPORT_FIELDS)
    expect(ok).toEqual([])
  })
})

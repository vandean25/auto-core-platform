import { describe, expect, it } from 'vitest'

import { CUSTOMER_IMPORT_FIELDS, VEHICLE_IMPORT_FIELDS } from './import-field-labels'
import {
  constrainMappingToCsvHeaders,
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

  it('maps vehicle external_id to Fahrzeug-Nr when Kunden-Nr appears first', () => {
    const headers = ['Kunden-Nr', 'Fahrzeug-Nr', 'Marke', 'Modell', 'Baujahr']
    const mapping = suggestColumnMapping(headers, VEHICLE_IMPORT_FIELDS)

    expect(mapping.external_id).toBe('Fahrzeug-Nr')
    expect(mapping.owner_customer_external_id).toBe('Kunden-Nr')
  })

  it('drops profile columns that are not in the current CSV headers', () => {
    const constrained = constrainMappingToCsvHeaders(
      { external_id: 'Missing-Col', last_name: 'Nachname' },
      ['Kunden-Nr', 'Nachname'],
    )
    expect(constrained).toEqual({ last_name: 'Nachname' })
  })

  it('flags missing required fields', () => {
    const missing = validateRequiredMappings({}, CUSTOMER_IMPORT_FIELDS)
    expect(missing).toEqual(['external_id'])

    const ok = validateRequiredMappings({ external_id: 'Kunden-Nr' }, CUSTOMER_IMPORT_FIELDS)
    expect(ok).toEqual([])
  })
})

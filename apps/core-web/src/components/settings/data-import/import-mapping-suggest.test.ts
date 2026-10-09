import { describe, expect, it } from 'vitest'

import {
  CUSTOMER_IMPORT_FIELDS,
  SUPPLIER_PRICE_LIST_IMPORT_FIELDS,
  VEHICLE_IMPORT_FIELDS,
} from './import-field-labels'
import {
  constrainMappingToCsvHeaders,
  suggestColumnMapping,
  validateRequiredMappings,
} from './import-mapping-suggest'

describe('import mapping suggest', () => {
  it('auto-suggests mixed German header aliases from a pilot-style CSV', () => {
    const headers = ['Kunden-Nr', 'Firma', 'Mail', 'Tel', 'Ust-ID', 'Zip']
    const mapping = suggestColumnMapping(headers, CUSTOMER_IMPORT_FIELDS)

    expect(mapping).toEqual({
      external_id: 'Kunden-Nr',
      company_name: 'Firma',
      email: 'Mail',
      phone: 'Tel',
      vat_id: 'Ust-ID',
      address_zip: 'Zip',
    })
  })

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

  it('auto-suggests supplier price list columns from German supplier CSV', () => {
    const headers = [
      'Lieferanten-Artikelnummer',
      'EAN',
      'Beschreibung',
      'Marke',
      'Einkaufspreis',
      'UVP',
      'Einheit',
    ]
    const mapping = suggestColumnMapping(headers, SUPPLIER_PRICE_LIST_IMPORT_FIELDS)

    expect(mapping).toEqual({
      supplier_article_no: 'Lieferanten-Artikelnummer',
      ean: 'EAN',
      description: 'Beschreibung',
      brand: 'Marke',
      cost_price: 'Einkaufspreis',
      rrp: 'UVP',
      unit: 'Einheit',
    })
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

    const supplierMissing = validateRequiredMappings({}, SUPPLIER_PRICE_LIST_IMPORT_FIELDS)
    expect(supplierMissing).toEqual(['supplier_article_no', 'description', 'cost_price'])

    const supplierOk = validateRequiredMappings(
      {
        supplier_article_no: 'ArtNr',
        description: 'Bezeichnung',
        cost_price: 'EK',
      },
      SUPPLIER_PRICE_LIST_IMPORT_FIELDS,
    )
    expect(supplierOk).toEqual([])
  })
})

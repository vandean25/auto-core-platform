// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  UnknownImportEntityTypeError,
  toImportEntityTypeUi,
  wizardImportEntityTypes,
} from '@/lib/i18n/enum-registry'
import { readImportEntityTypeRegistry } from '@/test/import-entity-type-registry'

import { getImportFieldsForEntity } from './import-field-labels'

const registry = readImportEntityTypeRegistry()
const wizardEntries = registry.filter((entry) => entry.wizard)
const apiOnlyEntries = registry.filter((entry) => !entry.wizard)

describe('import entity types from the core-api registry', () => {
  it('offers the four wizard types in registry order', () => {
    expect(wizardImportEntityTypes(registry)).toEqual([
      'CUSTOMER',
      'VEHICLE',
      'SUPPLIER_PRICE_LIST',
      'LABOR_OPERATION',
    ])
  })

  it.each(wizardEntries)('defines the required template fields of $entity_type', (entry) => {
    const fields = getImportFieldsForEntity(toImportEntityTypeUi(entry.entity_type))

    expect(
      fields
        .filter((field) => field.required)
        .map((field) => field.key)
        .sort(),
    ).toEqual([...entry.required_fields].sort())
  })

  it.each(apiOnlyEntries)('rejects the API-only type $entity_type with a typed error', (entry) => {
    expect(() => toImportEntityTypeUi(entry.entity_type)).toThrow(UnknownImportEntityTypeError)
  })

  it('keeps the two API-only types out of the wizard', () => {
    expect(apiOnlyEntries.map((entry) => entry.entity_type).sort()).toEqual([
      'VEHICLE_DUE_DATE',
      'VEHICLE_PARTY',
    ])
  })

  it('fails loudly when the registry opens the wizard for a type without field definitions', () => {
    expect(() =>
      wizardImportEntityTypes([
        { entity_type: 'VEHICLE_PARTY', wizard: true, required_fields: ['external_id'] },
      ]),
    ).toThrow(UnknownImportEntityTypeError)
  })
})

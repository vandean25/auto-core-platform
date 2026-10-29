// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { getImportFieldsForEntity } from '@/components/settings/data-import/import-field-labels'
import { readImportEntityTypeRegistry } from '@/test/import-entity-type-registry'

import deEnums from '../../../../../locales/de/enums.json'
import enEnums from '../../../../../locales/en/enums.json'
import {
  DATA_TABLE_COLUMN_IDS,
  STATUS_ENUM_VALUES,
  importFieldSegmentForEntity,
  wizardImportEntityTypes,
  type ImplementedImportEntityType,
} from './enum-registry'

const importRegistry = readImportEntityTypeRegistry()
const wizardImportTypes = wizardImportEntityTypes(importRegistry)

function leafKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : []
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      return leafKeys(child, next)
    }
    return [next]
  })
}

const statusBadgeKeys = [
  ...readFileSync('src/components/status/StatusBadge.tsx', 'utf8').matchAll(
    /^\s+([A-Z][A-Z0-9_]*): '/gm,
  ),
].map((match) => match[1])

describe('enum locale resources', () => {
  it('keeps DE and EN enum trees aligned', () => {
    expect(leafKeys(deEnums).sort()).toEqual(leafKeys(enEnums).sort())
  })

  it('covers every shared status wire value', () => {
    const statusRecord = deEnums.status satisfies Record<(typeof STATUS_ENUM_VALUES)[number], string>
    for (const value of STATUS_ENUM_VALUES) {
      expect(statusRecord[value].length).toBeGreaterThan(0)
      expect(enEnums.status[value].length).toBeGreaterThan(0)
    }
  })

  it('covers every StatusBadge wire value', () => {
    for (const value of statusBadgeKeys) {
      expect(deEnums.status[value as keyof typeof deEnums.status]?.length).toBeGreaterThan(0)
      expect(enEnums.status[value as keyof typeof enEnums.status]?.length).toBeGreaterThan(0)
    }
  })

  it('covers import entity types and field keys', () => {
    const entityRecord = deEnums.importEntityType satisfies Record<ImplementedImportEntityType, string>
    for (const { entity_type: entityType } of importRegistry) {
      expect(entityRecord[entityType].length).toBeGreaterThan(0)
      expect(enEnums.importEntityType[entityType].length).toBeGreaterThan(0)
    }
    for (const entityType of wizardImportTypes) {
      const segment = importFieldSegmentForEntity(entityType)
      const segmentFields = deEnums.importField[segment] as Record<string, string>
      for (const field of getImportFieldsForEntity(entityType)) {
        expect(segmentFields[field.key]?.length).toBeGreaterThan(0)
        expect((enEnums.importField[segment] as Record<string, string>)[field.key]?.length).toBeGreaterThan(0)
      }
    }
  })

  it('covers data table column ids', () => {
    const columnRecord = deEnums.dataTableColumn satisfies Record<(typeof DATA_TABLE_COLUMN_IDS)[number], string>
    for (const id of DATA_TABLE_COLUMN_IDS) {
      expect(columnRecord[id].length).toBeGreaterThan(0)
    }
  })

  it('keeps EN import field copy distinct from DE for header matching', () => {
    for (const entityType of wizardImportTypes) {
      const segment = importFieldSegmentForEntity(entityType)
      const deFields = deEnums.importField[segment] as Record<string, string>
      const enFields = enEnums.importField[segment] as Record<string, string>
      for (const field of getImportFieldsForEntity(entityType)) {
        if (field.key === 'ean') continue
        expect(enFields[field.key]).not.toBe(deFields[field.key])
      }
    }
    expect(enEnums.importField.vehicle.owner_customer_external_id).toBe('Owner customer number')
  })

  it('uses German glossary-aligned data table column labels in DE', () => {
    expect(deEnums.dataTableColumn.binLabel).toBe('Lagerplatz')
    expect(deEnums.dataTableColumn.creditNumber).toBe('Gutschriftnummer')
    expect(deEnums.dataTableColumn.plate).toBe('Kennzeichen')
    expect(deEnums.dataTableColumn.vin).toBe('FIN')
    expect(deEnums.dataTableColumn.warrantyEnds).toBe('Gewährleistung endet')
    expect(deEnums.dataTableColumn.customerName).not.toBe(enEnums.dataTableColumn.customerName)
  })

  it('uses glossary-aligned status labels', () => {
    expect(enEnums.status.INTAKE).toBe('Check-in')
    expect(enEnums.status.GEWAEHRLEISTUNG_ACTIVE).toMatch(/^Statutory warranty /i)
    expect(deEnums.status.CHECK_IN).toBe('Einlagerung')
    expect(deEnums.status.CHECK_OUT).toBe('Auslagerung')
  })
})

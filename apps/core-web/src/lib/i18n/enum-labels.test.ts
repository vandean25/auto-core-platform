// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { i18n } from '@/lib/i18n'
import {
  formatDataTableColumnId,
  formatImportFieldLabel,
  formatStatusLabel,
  formatTenantMemberRole,
  translateEnum,
} from './enum-labels'

describe('enum label helpers', () => {
  it('resolves status labels from the active DE resource', () => {
    expect(formatStatusLabel('DRAFT')).toBe(i18n.t('enums:status.DRAFT'))
    expect(formatStatusLabel('IN_PROGRESS')).toBe('In Bearbeitung')
  })

  it('resolves import field labels per entity segment', () => {
    expect(formatImportFieldLabel('CUSTOMER', 'external_id')).toBe('Kunden-Nr')
    expect(formatImportFieldLabel('VEHICLE', 'external_id')).toBe('Fahrzeug-Nr')
  })

  it('resolves data table column ids from enums', () => {
    expect(formatDataTableColumnId('customerName')).toBe(i18n.t('enums:dataTableColumn.customerName'))
  })

  it('names every workshop member role in German and leaves an unknown role as sent', () => {
    expect(['OWNER', 'ADMIN', 'TECH', 'SALES'].map(formatTenantMemberRole)).toEqual([
      'Inhaber',
      'Administrator',
      'Mechaniker',
      'Verkauf',
    ])
    expect(formatTenantMemberRole('AUDITOR')).toBe('AUDITOR')
  })

  it('resolves letterhead copy keys', () => {
    expect(translateEnum('letterheadSource', 'message', 'quarantined')).toBe('Datei wird geprüft…')
  })
})

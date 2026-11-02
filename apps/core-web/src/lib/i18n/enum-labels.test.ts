// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { i18n } from '@/lib/i18n'
import {
  formatDataTableColumnId,
  formatImportFieldLabel,
  formatStatusLabel,
  formatTenantMemberRole,
  formatTyreSetStatusLabel,
  translateEnum,
} from './enum-labels'

describe('enum label helpers', () => {
  it('resolves status labels from the active DE resource', () => {
    expect(formatStatusLabel('DRAFT')).toBe(i18n.t('enums:status.DRAFT'))
    expect(formatStatusLabel('IN_PROGRESS')).toBe('In Bearbeitung')
  })

  it('keeps the tyre set NEW badge copy out of the generic NEW status label (AUT-852)', () => {
    expect(formatTyreSetStatusLabel('NEW')).toBe('Nicht eingelagert')
    expect(formatStatusLabel('NEW')).toBe('Neu')
  })

  it('falls back to the shared status block for tyre set values without own copy', () => {
    expect(formatTyreSetStatusLabel('IN_STORAGE')).toBe(formatStatusLabel('IN_STORAGE'))
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

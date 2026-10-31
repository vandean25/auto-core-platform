import { describe, expect, it } from 'vitest'
import deSettings from '../../../../../locales/de/settings.json'
import deVehicleStock from '../../../../../locales/de/vehicleStock.json'
import deVehicles from '../../../../../locales/de/vehicles.json'
import deWorkshop from '../../../../../locales/de/workshop.json'
import enSettings from '../../../../../locales/en/settings.json'
import enVehicleStock from '../../../../../locales/en/vehicleStock.json'
import enVehicles from '../../../../../locales/en/vehicles.json'
import enWorkshop from '../../../../../locales/en/workshop.json'

/**
 * AUT-791: the search hint of a list has to fit the 375 px wide search field (16 px text, no horizontal room to
 * spare). A longer hint is cut off in the middle of a word, so the lists below keep theirs short.
 */
const MAX_HINT_LENGTH = 34

const hints = {
  de: {
    'audit logs': deSettings.auditLogs.searchPlaceholder,
    'accounting export history': deSettings.accountingExport.history.searchPlaceholder,
    'Gewährleistung fällig': deVehicles.gewaehrleistungDue.searchPlaceholder,
    'vehicle stock': deVehicleStock.stockList.searchPlaceholder,
    'estimates (KVA)': deWorkshop.estimateList.searchPlaceholder,
  },
  en: {
    'audit logs': enSettings.auditLogs.searchPlaceholder,
    'accounting export history': enSettings.accountingExport.history.searchPlaceholder,
    'Gewährleistung fällig': enVehicles.gewaehrleistungDue.searchPlaceholder,
    'vehicle stock': enVehicleStock.stockList.searchPlaceholder,
    'estimates (KVA)': enWorkshop.estimateList.searchPlaceholder,
  },
}

describe('list search hints stay short enough for a phone', () => {
  for (const [language, byList] of Object.entries(hints)) {
    for (const [list, hint] of Object.entries(byList)) {
      it(`${language}: ${list} (${hint.length} characters)`, () => {
        expect(hint.length).toBeLessThanOrEqual(MAX_HINT_LENGTH)
      })
    }
  }

  it('still names everything the estimates search covers: number, work order, customer and plate', () => {
    expect(deWorkshop.estimateList.searchPlaceholder).toMatch(/Nr\./)
    for (const word of ['Auftrag', 'Kunde', 'Kennzeichen']) {
      expect(deWorkshop.estimateList.searchPlaceholder).toContain(word)
    }
    for (const word of ['number', 'order', 'customer', 'plate']) {
      expect(enWorkshop.estimateList.searchPlaceholder.toLowerCase()).toContain(word)
    }
  })

  it('still names what the audit log search covers', () => {
    expect(deSettings.auditLogs.searchPlaceholder).toContain('Akteur')
    expect(deSettings.auditLogs.searchPlaceholder).toContain('Request-ID')
  })
})

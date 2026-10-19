import './SettingsPage.test.support.test'

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
})

vi.mock('@/components/settings/workshop-hours-settings-panel', () => ({
  WorkshopHoursSettingsPanel: () => <div>Hours tab content</div>,
}))

vi.mock('@/components/settings/vehicle-data-settings-panel', () => ({
  VehicleDataSettingsPanel: () => <div>Vehicle data tab content</div>,
}))

vi.mock('@/components/settings/SitesSettingsTab', () => ({
  SitesSettingsTab: () => <div>Sites tab content</div>,
}))

vi.mock('@/components/settings/accounting-export-settings-panel', () => ({
  AccountingExportSettingsPanel: () => <div>Accounting export tab content</div>,
}))

import './SettingsPage.test.cases'

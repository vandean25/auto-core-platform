import React from 'react'
import { vi } from 'vitest'

vi.mock('@/components/settings/vehicle-data-settings-panel', () => ({
  VehicleDataSettingsPanel: () => React.createElement('div', null, 'Vehicle data tab content'),
}))

vi.mock('@/components/settings/workshop-hours-settings-panel', () => ({
  WorkshopHoursSettingsPanel: () => React.createElement('div', null, 'Hours tab content'),
}))

vi.mock('@/components/settings/accounting-export-settings-panel', () => ({
  AccountingExportSettingsPanel: () => React.createElement('div', null, 'Accounting export tab content'),
}))

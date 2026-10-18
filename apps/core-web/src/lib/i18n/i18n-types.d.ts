import 'i18next'
import type common from '../../../../../locales/de/common.json'
import type nav from '../../../../../locales/de/nav.json'
import type errors from '../../../../../locales/de/errors.json'
import type glossary from '../../../../../locales/de/glossary.json'
import type enums from '../../../../../locales/de/enums.json'
import type customers from '../../../../../locales/de/customers.json'
import type sales from '../../../../../locales/de/sales.json'
import type vehicles from '../../../../../locales/de/vehicles.json'
import type workshop from '../../../../../locales/de/workshop.json'
import type vehicleStock from '../../../../../locales/de/vehicleStock.json'
import type finance from '../../../../../locales/de/finance.json'
import type inventory from '../../../../../locales/de/inventory.json'
import type hr from '../../../../../locales/de/hr.json'
import type settings from '../../../../../locales/de/settings.json'
import type platform from '../../../../../locales/de/platform.json'
import type reports from '../../../../../locales/de/reports.json'
import type agent from '../../../../../locales/de/agent.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: {
      common: typeof common
      nav: typeof nav
      errors: typeof errors
      glossary: typeof glossary
      enums: typeof enums
      customers: typeof customers
      sales: typeof sales
      vehicles: typeof vehicles
      workshop: typeof workshop
      vehicleStock: typeof vehicleStock
      finance: typeof finance
      inventory: typeof inventory
      hr: typeof hr
      settings: typeof settings
      platform: typeof platform
      reports: typeof reports
      agent: typeof agent
    }
  }
}

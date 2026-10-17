import 'i18next'
import type common from '../../../../../locales/de/common.json'
import type nav from '../../../../../locales/de/nav.json'
import type errors from '../../../../../locales/de/errors.json'
import type glossary from '../../../../../locales/de/glossary.json'
import type enums from '../../../../../locales/de/enums.json'
import type customers from '../../../../../locales/de/customers.json'
import type workshop from '../../../../../locales/de/workshop.json'
import type vehicleStock from '../../../../../locales/de/vehicleStock.json'

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
      workshop: typeof workshop
      vehicleStock: typeof vehicleStock
    }
  }
}

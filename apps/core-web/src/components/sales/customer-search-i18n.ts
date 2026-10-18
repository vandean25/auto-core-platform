import { ensureNamespaceLoaded } from '@/lib/i18n'

export function ensureCustomerSearchI18n() {
  return ensureNamespaceLoaded('customers')
}

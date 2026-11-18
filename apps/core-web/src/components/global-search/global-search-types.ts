import {
  Building2,
  Calendar,
  Car,
  CarFront,
  ClipboardList,
  Clock,
  FileSignature,
  FileText,
  MapPin,
  Package,
  ReceiptEuro,
  ReceiptText,
  ShoppingCart,
  Store,
  Truck,
  UserCheck,
  UserRound,
  Users,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { SearchResultType } from '@/api/search'
import type nav from '../../../../../locales/de/nav.json'

type SearchGroupLabelKey = `nav:globalSearch.groups.${keyof typeof nav.globalSearch.groups}`

type SearchTypeEntry = {
  icon: LucideIcon
  labelKey: SearchGroupLabelKey
  /** Typed as `<prefix>:` in front of the query to search this type only. */
  prefix: string
}

/** One entry per search type: drives the group icon and label, the prefix filters and the help text. */
export const SEARCH_TYPE_REGISTRY: Record<SearchResultType, SearchTypeEntry> = {
  customer: { icon: UserRound, labelKey: 'nav:globalSearch.groups.customer', prefix: 'k' },
  vehicle: { icon: Car, labelKey: 'nav:globalSearch.groups.vehicle', prefix: 'fz' },
  stock_vehicle: { icon: Store, labelKey: 'nav:globalSearch.groups.stockVehicle', prefix: 'fz' },
  workshop_order: { icon: Wrench, labelKey: 'nav:globalSearch.groups.workshopOrder', prefix: 'a' },
  appointment: { icon: Calendar, labelKey: 'nav:globalSearch.groups.appointment', prefix: 'tm' },
  estimate: { icon: FileSignature, labelKey: 'nav:globalSearch.groups.estimate', prefix: 'kv' },
  sales_order: { icon: ClipboardList, labelKey: 'nav:globalSearch.groups.salesOrder', prefix: 'ka' },
  vehicle_sale: { icon: CarFront, labelKey: 'nav:globalSearch.groups.vehicleSale', prefix: 'vk' },
  invoice: { icon: FileText, labelKey: 'nav:globalSearch.groups.invoice', prefix: 'r' },
  credit_note: { icon: ReceiptEuro, labelKey: 'nav:globalSearch.groups.creditNote', prefix: 'g' },
  part: { icon: Package, labelKey: 'nav:globalSearch.groups.part', prefix: 't' },
  labor_operation: { icon: Clock, labelKey: 'nav:globalSearch.groups.laborOperation', prefix: 'aw' },
  vendor: { icon: Truck, labelKey: 'nav:globalSearch.groups.vendor', prefix: 'l' },
  purchase_order: { icon: ShoppingCart, labelKey: 'nav:globalSearch.groups.purchaseOrder', prefix: 'b' },
  purchase_invoice: { icon: ReceiptText, labelKey: 'nav:globalSearch.groups.purchaseInvoice', prefix: 'er' },
  employee: { icon: Users, labelKey: 'nav:globalSearch.groups.employee', prefix: 'm' },
  user: { icon: UserCheck, labelKey: 'nav:globalSearch.groups.user', prefix: 'u' },
  legal_entity: { icon: Building2, labelKey: 'nav:globalSearch.groups.legalEntity', prefix: 'f' },
  site: { icon: MapPin, labelKey: 'nav:globalSearch.groups.site', prefix: 's' },
}

const SEARCH_TYPES = Object.keys(SEARCH_TYPE_REGISTRY) as SearchResultType[]

// Mirrors SearchQueryDto: at most 100 characters.
const MAX_QUERY_LENGTH = 100
const PREFIX_PATTERN = /^([a-z]+):\s*/i

export type ParsedSearchInput = { q: string; types?: SearchResultType[] }

/** Splits an optional `k:`/`fz:`/`a:`/`r:`/`t:` prefix off the input. An unknown prefix stays part of the query. */
export function parseSearchInput(input: string): ParsedSearchInput {
  const trimmed = input.trim()
  const match = PREFIX_PATTERN.exec(trimmed)
  const prefix = match?.[1].toLowerCase()
  const types = SEARCH_TYPES.filter((type) => SEARCH_TYPE_REGISTRY[type].prefix === prefix)

  if (!match || types.length === 0) return { q: trimmed.slice(0, MAX_QUERY_LENGTH).trim() }
  return { q: trimmed.slice(match[0].length, match[0].length + MAX_QUERY_LENGTH).trim(), types }
}

/** Mirrors the backend rule (SearchQueryDto): two characters, or one when the input is only digits. */
export function isSearchableQuery(q: string): boolean {
  return /^(\d+|.{2,})$/s.test(q)
}

/** One entry per distinct prefix, labelled by the first type that uses it. */
export function getSearchPrefixes(): { prefix: string; type: SearchResultType }[] {
  return SEARCH_TYPES.filter(
    (type, index) =>
      SEARCH_TYPES.findIndex((other) => SEARCH_TYPE_REGISTRY[other].prefix === SEARCH_TYPE_REGISTRY[type].prefix) ===
      index,
  ).map((type) => ({ prefix: SEARCH_TYPE_REGISTRY[type].prefix, type }))
}

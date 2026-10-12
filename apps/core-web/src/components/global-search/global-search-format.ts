import type { WorkshopOrder } from '@/api/types'
import type { WorkshopSearchCustomer, WorkshopSearchVehicle } from '@/hooks/useGlobalSearch'
import { getWorkshopCustomerDisplayName } from '@/features/workshop/pick-utils'

export const currencyFormatter = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})

export const truncate = (text: string, max = 50) =>
  text.length > max ? `${text.slice(0, max).trimEnd()}…` : text

export function getCustomerDisplayName(customer: WorkshopSearchCustomer): string {
  const personName = `${customer.first_name} ${customer.last_name}`.trim()
  if (customer.type !== 'COMPANY') return personName
  return customer.company_name || personName
}

export function getCustomerContactDetails(customer: WorkshopSearchCustomer): string {
  return [customer.email, customer.phone].filter(Boolean).join(' • ')
}

export function getCustomerSearchValue(customer: WorkshopSearchCustomer): string {
  return `${getCustomerDisplayName(customer)} ${customer.company_name ?? ''} ${customer.first_name} ${customer.last_name} ${customer.email ?? ''} ${customer.phone ?? ''}`
}

export function getVehicleMakeModel(vehicle: WorkshopSearchVehicle): string {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim()
}

export function getVehicleSubtitle(vehicle: WorkshopSearchVehicle, makeModel: string): string {
  if (vehicle.plate) {
    return `${makeModel}${vehicle.vin ? ` • VIN: ${vehicle.vin}` : ''}`
  }
  return vehicle.vin ? `VIN: ${vehicle.vin}` : ''
}

export function getOrderVehicleSummary(order: WorkshopOrder): string {
  if (!order.vehicle) return ''
  return `${order.vehicle.make} ${order.vehicle.model}${order.vehicle.plate ? ` (${order.vehicle.plate})` : ''}`
}

export function getOrderSubtitle(order: WorkshopOrder): string {
  return [getWorkshopCustomerDisplayName(order), getOrderVehicleSummary(order)]
    .filter(Boolean)
    .join(' • ')
}

export function getOrderSearchValue(order: WorkshopOrder): string {
  return `${order.order_number ?? order.id} ${getWorkshopCustomerDisplayName(order)} ${getOrderVehicleSummary(order)}`
}

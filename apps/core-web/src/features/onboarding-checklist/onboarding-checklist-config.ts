import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

/** Tenant roles that see the static onboarding checklist; matches the sidebar's admin-only modules. */
export const ONBOARDING_CHECKLIST_ROLES: ReadonlyArray<string> = ['OWNER', 'ADMIN']

export type OnboardingChecklistStep = {
  id: string
  title: string
  description: string
  actionLabel: string
  to: string
}

export const ONBOARDING_CHECKLIST_STEPS: ReadonlyArray<OnboardingChecklistStep> = [
  {
    id: 'customers',
    title: 'Create customers',
    description: 'Add the private and company customers you bill and service.',
    actionLabel: 'Open customers',
    to: APP_ROUTE_PATHS.customers,
  },
  {
    id: 'vehicles',
    title: 'Add vehicles',
    description: 'Register the cars you service so every job links to the right vehicle.',
    actionLabel: 'Open vehicles',
    to: APP_ROUTE_PATHS.vehicles,
  },
  {
    id: 'inventory',
    title: 'Add inventory items',
    description: 'Load the parts and supplies you keep on the shelf.',
    actionLabel: 'Open inventory',
    to: APP_ROUTE_PATHS.inventory,
  },
  {
    id: 'workshop-order',
    title: 'Create the first workshop order',
    description: 'Book a first job for a customer and vehicle.',
    actionLabel: 'Open workshop orders',
    to: APP_ROUTE_PATHS.workshopOrders,
  },
]

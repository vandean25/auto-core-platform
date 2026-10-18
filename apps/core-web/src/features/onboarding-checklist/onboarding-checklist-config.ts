import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

/** Tenant roles that see the static onboarding checklist; matches the sidebar's admin-only modules. */
export const ONBOARDING_CHECKLIST_ROLES: ReadonlyArray<string> = ['OWNER', 'ADMIN']

export type OnboardingChecklistStep = {
  id: 'customers' | 'vehicles' | 'inventory' | 'workshop-order'
  to: string
}

export const ONBOARDING_CHECKLIST_STEPS: ReadonlyArray<OnboardingChecklistStep> = [
  {
    id: 'customers',
    to: APP_ROUTE_PATHS.customers,
  },
  {
    id: 'vehicles',
    to: APP_ROUTE_PATHS.vehicles,
  },
  {
    id: 'inventory',
    to: APP_ROUTE_PATHS.inventory,
  },
  {
    id: 'workshop-order',
    to: APP_ROUTE_PATHS.workshopOrders,
  },
]

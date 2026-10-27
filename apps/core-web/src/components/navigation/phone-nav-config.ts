import { getVisibleNavGroups, type NavAccessContext, type NavItem } from './nav-config'

/**
 * Bottom navigation of the admin shell below md. The destinations are ids of the typed nav config
 * (`NAV_GROUPS`), so the sidebar stays the only navigation source. Mechanics (TECH) use the mechanic
 * shell, whose bar (`MechanicPhoneNav`) shows destinations that are not in the sidebar.
 */
export type PhoneNavVariant = 'advisor' | 'default'

type PhoneNavDestination = {
  /** Id in `NAV_GROUPS`: link, icon, visibility and active rule come from there. */
  id: string
  /** Short bar label (`nav:phoneNav.*`): the sidebar labels do not fit five slots at 375px. */
  labelKey: `phoneNav.${'orders' | 'appointments' | 'dashboard'}`
}

/** Destinations left of the central create button. */
export const PHONE_NAV_DESTINATIONS: Record<PhoneNavVariant, readonly PhoneNavDestination[]> = {
  // Orders and appointments (the workshop planner).
  advisor: [
    { id: 'workshop-orders', labelKey: 'phoneNav.orders' },
    { id: 'workshop-planner', labelKey: 'phoneNav.appointments' },
  ],
  // Every other role: Dashboard and Orders.
  default: [
    { id: 'dashboard', labelKey: 'phoneNav.dashboard' },
    { id: 'workshop-orders', labelKey: 'phoneNav.orders' },
  ],
}

/** `SALES` is the front-desk tenant role; the generated role enum has no separate service advisor. */
export function getPhoneNavVariant(activeRole: string | null): PhoneNavVariant {
  return activeRole === 'SALES' ? 'advisor' : 'default'
}

/** The visible sidebar entries the role shows as bottom bar destinations, in bar order. */
export function getPhoneNavDestinations(context: NavAccessContext): (NavItem & { phoneLabelKey: PhoneNavDestination['labelKey'] })[] {
  const items = getVisibleNavGroups(context).flatMap((group) => group.items)
  return PHONE_NAV_DESTINATIONS[getPhoneNavVariant(context.activeRole)].flatMap(({ id, labelKey }) => {
    const item = items.find((candidate) => candidate.id === id)
    return item ? [{ ...item, phoneLabelKey: labelKey }] : []
  })
}

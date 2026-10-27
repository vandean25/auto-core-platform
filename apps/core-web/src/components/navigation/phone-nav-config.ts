import { getVisibleNavGroups, type NavAccessContext, type NavItem } from './nav-config'

/**
 * Bottom navigation below md. The destinations are ids of the typed nav config (`NAV_GROUPS`), so the
 * sidebar stays the only navigation source. Mechanic destinations live outside the sidebar, so they
 * are not in this config.
 */
export type PhoneNavVariant = 'mechanic' | 'advisor' | 'default'

type PhoneNavDestination = {
  /** Id in `NAV_GROUPS`: link, icon, visibility and active rule come from there. */
  id: string
  /** Short bar label (`nav:phoneNav.*`): the sidebar labels do not fit five slots at 375px. */
  labelKey: `phoneNav.${'orders' | 'appointments' | 'dashboard'}`
}

type PhoneNavLayout = {
  /** Destinations left of the central create button. */
  destinations: readonly PhoneNavDestination[]
  /** `finding` records a finding on the active task, `new` opens the create sheet. */
  create: 'finding' | 'new'
}

export const PHONE_NAV_LAYOUTS: Record<PhoneNavVariant, PhoneNavLayout> = {
  mechanic: { destinations: [], create: 'finding' },
  // Orders, appointments (the workshop planner), + New (work order / appointment).
  advisor: {
    destinations: [
      { id: 'workshop-orders', labelKey: 'phoneNav.orders' },
      { id: 'workshop-planner', labelKey: 'phoneNav.appointments' },
    ],
    create: 'new',
  },
  // Every other role: Dashboard, Orders, + New.
  default: {
    destinations: [
      { id: 'dashboard', labelKey: 'phoneNav.dashboard' },
      { id: 'workshop-orders', labelKey: 'phoneNav.orders' },
    ],
    create: 'new',
  },
}

/** `ADVISOR` is not in the generated tenant role enum (the sidebar rules list it too); `SALES` is the front-desk role. */
const ADVISOR_ROLES: readonly string[] = ['SALES', 'ADVISOR']

export function getPhoneNavVariant(activeRole: string | null): PhoneNavVariant {
  if (activeRole === 'TECH') return 'mechanic'
  return ADVISOR_ROLES.includes(activeRole ?? '') ? 'advisor' : 'default'
}

/** The visible sidebar entries the variant shows as bottom bar destinations, in bar order. */
export function getPhoneNavDestinations(context: NavAccessContext): (NavItem & { phoneLabelKey: PhoneNavDestination['labelKey'] })[] {
  const items = getVisibleNavGroups(context).flatMap((group) => group.items)
  return PHONE_NAV_LAYOUTS[getPhoneNavVariant(context.activeRole)].destinations.flatMap(({ id, labelKey }) => {
    const item = items.find((candidate) => candidate.id === id)
    return item ? [{ ...item, phoneLabelKey: labelKey }] : []
  })
}

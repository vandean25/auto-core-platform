import type { LucideIcon } from 'lucide-react'

export type QuickAction = {
  href: string
  icon: LucideIcon
  label: string
  description: string
  /** Extra phrases the palette search matches, such as the action's previous wording. */
  keywords?: string[]
}

export type QuickActionSection = {
  heading: string
  items: QuickAction[]
}

/**
 * Keeps the actions whose label, description or keywords contain the query, dropping
 * sections that end up empty. An empty query returns every section.
 */
export function filterQuickActionSections(
  sections: QuickActionSection[],
  query: string,
): QuickActionSection[] {
  if (!query) return sections

  const lower = query.toLowerCase()
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        [item.label, item.description, ...(item.keywords ?? [])].some((text) =>
          text.toLowerCase().includes(lower),
        ),
      ),
    }))
    .filter((section) => section.items.length > 0)
}

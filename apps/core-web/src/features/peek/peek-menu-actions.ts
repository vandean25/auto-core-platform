import {
  mapRegistryActionsToPalette,
  type PaletteContextAction,
} from '@/components/global-search/global-search-context-actions'
import type { EntityActionDefinition } from '@/features/actions/entity-action'

/**
 * Registry actions for the peek sheet's "more actions" menu. The registry's `*.open` navigate action is left out:
 * the footer's primary button already opens the record in full. Actions whose nested choices are empty in the peek
 * (for example mechanics that were not loaded) are dropped, as in the command palette.
 */
export function buildPeekMenuActions<TRecord extends object, TRunContext>(
  definitions: EntityActionDefinition<TRecord, TRunContext>[],
  role: string | undefined,
  record: TRecord,
  runContext: TRunContext,
): PaletteContextAction[] {
  const withoutOpen = definitions.filter(
    (definition) => !(definition.kind === 'navigate' && definition.id.endsWith('.open')),
  )
  return mapRegistryActionsToPalette(withoutOpen, role, record, runContext, () => '')
}

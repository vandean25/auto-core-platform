import type { LucideIcon } from 'lucide-react'

import type { DataTableRowContextAction } from '@/components/data-table/data-table-context-menu'
import { requestEntityActionConfirm } from './action-confirm-host'

/**
 * Stable registry action id format: `<entity>.<action>` with optional dot-separated
 * child segments (`<entity>.<action>.<segment>...`, e.g. `customer.delete`,
 * `workOrder.jobCardPdf`, `workOrder.taskState.t1.done`). The first segment is the
 * camelCase entity name (`[a-z][a-zA-Z0-9]*`); each following segment is non-empty
 * alphanumeric (`[a-zA-Z0-9]+`) so child sub-menu items can include record ids.
 * Page action buttons rendered from the registry expose this id via `data-action-id`
 * so automated guard tests (AUT-700) can verify every page action resolves to a
 * registered definition.
 */
export const ENTITY_ACTION_ID_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/

export const ENTITY_ACTION_IDS = {
  customerOpen: 'customer.open',
  customerDelete: 'customer.delete',
  workOrderOpen: 'workOrder.open',
  workOrderCheckIn: 'workOrder.checkIn',
  workOrderJobCardPdf: 'workOrder.jobCardPdf',
  workOrderAssignMechanic: 'workOrder.assignMechanic',
  workOrderTaskState: 'workOrder.taskState',
  vehicleOpen: 'vehicle.open',
} as const

export const REGISTERED_ENTITY_ACTION_IDS: readonly string[] = Object.values(ENTITY_ACTION_IDS)

export function isValidEntityActionId(id: string): boolean {
  return ENTITY_ACTION_ID_PATTERN.test(id)
}

export function isRegisteredEntityActionId(id: string): boolean {
  return isValidEntityActionId(id) && REGISTERED_ENTITY_ACTION_IDS.includes(id)
}

export type EntityActionKind = 'run' | 'navigate' | 'dialog'

export type EntityActionConfirmPrompt = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
}

export type EntityActionConfirm<TRecord> =
  | EntityActionConfirmPrompt
  | ((record: TRecord) => EntityActionConfirmPrompt)

type EntityActionConfirmationVariant<TRecord> =
  | {
      destructive?: false | undefined
      confirm?: EntityActionConfirm<TRecord>
    }
  | {
      destructive: true
      confirm: EntityActionConfirm<TRecord>
    }

export type EntityActionChild<TRecord, TRunContext> = {
  id: string
  label: string
  description?: string
  icon?: LucideIcon
  isAllowedForRole?: (role: string | undefined) => boolean
  isEnabled?: (record: TRecord) => boolean
  children?: EntityActionChildren<TRecord, TRunContext>
  run?: (record: TRecord, context: TRunContext) => void | Promise<void>
} & EntityActionConfirmationVariant<TRecord>

export type EntityActionChildren<TRecord, TRunContext> =
  | EntityActionChild<TRecord, TRunContext>[]
  | ((record: TRecord, context: TRunContext) => EntityActionChild<TRecord, TRunContext>[])

export type EntityActionDefinition<TRecord, TRunContext> = {
  id: string
  label: string
  kind?: EntityActionKind
  icon?: LucideIcon
  /** Single-letter shortcut when a list row is focused (AUT-694). */
  shortcutKey?: string
  isAllowedForRole: (role: string | undefined) => boolean
  isEnabled: (record: TRecord) => boolean
  children?: EntityActionChildren<TRecord, TRunContext>
  run: (record: TRecord, context: TRunContext) => void | Promise<void>
} & EntityActionConfirmationVariant<TRecord>

export function resolveEntityActionChildren<TRecord, TRunContext>(
  children: EntityActionChildren<TRecord, TRunContext> | undefined,
  record: TRecord,
  runContext: TRunContext,
): EntityActionChild<TRecord, TRunContext>[] | undefined {
  if (!children) return undefined
  return typeof children === 'function' ? children(record, runContext) : children
}

export function executeEntityAction<TRecord, TRunContext>(
  definition: Pick<
    EntityActionDefinition<TRecord, TRunContext>,
    'confirm' | 'destructive'
  > & {
    run?: (record: TRecord, context: TRunContext) => void | Promise<void>
  },
  record: TRecord,
  runContext: TRunContext,
): void {
  const runner = definition.run
  if (!runner) return

  if (definition.confirm) {
    const prompt =
      typeof definition.confirm === 'function'
        ? definition.confirm(record)
        : definition.confirm
    requestEntityActionConfirm({
      ...prompt,
      destructive: definition.destructive,
      onConfirm: () => {
        void runner(record, runContext)
      },
    })
    return
  }

  void runner(record, runContext)
}

export function filterEntityActions<TRecord extends object, TRunContext>(
  definitions: EntityActionDefinition<TRecord, TRunContext>[],
  role: string | undefined,
  record: TRecord,
): EntityActionDefinition<TRecord, TRunContext>[] {
  return definitions.filter(
    (definition) => definition.isAllowedForRole(role) && definition.isEnabled(record),
  )
}

export function toDataTableContextActions<TRecord extends object, TRunContext>(
  definitions: EntityActionDefinition<TRecord, TRunContext>[],
  role: string | undefined,
  record: TRecord,
  runContext: TRunContext,
): DataTableRowContextAction<TRecord>[] {
  return filterEntityActions(definitions, role, record)
    .filter((definition) => !definition.children)
    .map((definition) => ({
      id: definition.id,
      label: definition.label,
      destructive: definition.destructive,
      onClick: () => {
        executeEntityAction(definition, record, runContext)
      },
    }))
}

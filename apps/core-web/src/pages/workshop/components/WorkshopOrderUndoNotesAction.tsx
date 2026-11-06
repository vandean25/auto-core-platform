import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import type { WorkshopOrder } from '@/api/types'
import { useAuthSession } from '@/api/auth-session'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'
import {
  createWorkshopOrderUndoNotesAction,
  type WorkshopOrderUndoNotesRunContext,
} from '@/features/actions/work-order-undo-notes-action'
import { setGlobalUndoRunner } from '@/features/interaction/undo-eligible-entry-store'
import { useUndoEligibleEntry } from '@/features/interaction/use-undo-eligible-entry'

type WorkshopOrderUndoNotesActionProps = {
  order: WorkshopOrder
  runNotesUndo: (orderId: string) => Promise<void>
}

/** Record UI entry for the pilot undo action (toast/Cmd+K share the same registry action). */
export function WorkshopOrderUndoNotesAction({
  order,
  runNotesUndo,
}: WorkshopOrderUndoNotesActionProps) {
  const { t } = useTranslation('workshop')
  const activeRole = useAuthSession()?.data?.activeRole
  useUndoEligibleEntry()
  const definition = createWorkshopOrderUndoNotesAction(t)
  const runContext: WorkshopOrderUndoNotesRunContext = {
    undoNotes: (orderId) => runNotesUndo(orderId),
  }

  useEffect(() => {
    setGlobalUndoRunner((orderId) => {
      void runNotesUndo(orderId)
    })
    return () => {
      setGlobalUndoRunner(null)
    }
  }, [runNotesUndo])

  return (
    <RegistryActionButton
      action={definition}
      record={order}
      runContext={runContext}
      role={activeRole}
      variant="outline"
      size="sm"
      className="min-h-11"
    />
  )
}

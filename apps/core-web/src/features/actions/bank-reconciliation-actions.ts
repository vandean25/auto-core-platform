import type { TFunction } from 'i18next'
import { Check, EyeOff, Undo2, Upload } from 'lucide-react'

import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

export type BankReconciliationActionRecord = {
  id?: string
}

export type BankReconciliationActionContext = {
  uploadStatement?: () => void | Promise<void>
  confirmTransaction?: () => void | Promise<void>
  ignoreTransaction?: () => void | Promise<void>
  undoTransaction?: () => void | Promise<void>
}

const isOwnerOrAdmin = (role: string | null | undefined): boolean =>
  role === 'OWNER' || role === 'ADMIN'

export function createBankReconciliationActions<
  TRecord extends BankReconciliationActionRecord = BankReconciliationActionRecord,
>(
  t: TFunction<'finance'>,
): EntityActionDefinition<TRecord, BankReconciliationActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.bankStatementUpload,
      kind: 'run',
      label: t('bankReconciliation.uploadStatement'),
      icon: Upload,
      isAllowedForRole: isOwnerOrAdmin,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.uploadStatement?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.bankTransactionConfirm,
      kind: 'run',
      label: t('bankReconciliation.actions.confirm'),
      icon: Check,
      isAllowedForRole: isOwnerOrAdmin,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.confirmTransaction?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.bankTransactionIgnore,
      kind: 'run',
      label: t('bankReconciliation.actions.ignore'),
      icon: EyeOff,
      isAllowedForRole: isOwnerOrAdmin,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.ignoreTransaction?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.bankTransactionUndo,
      kind: 'run',
      label: t('bankReconciliation.actions.undo'),
      icon: Undo2,
      isAllowedForRole: isOwnerOrAdmin,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.undoTransaction?.()
      },
    },
  ]
}

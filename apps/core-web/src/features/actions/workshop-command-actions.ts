import type { TFunction } from 'i18next'
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  HelpCircle,
  Mic,
  Pencil,
  RotateCcw,
} from 'lucide-react'

import {
  canApplyWorkshopCommand,
  canOpenWorkshopOrder,
  canUseWorkshopCommand,
} from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

export type WorkshopCommandActionRecord = {
  id?: string
  commandId?: string
}

export type WorkshopCommandActionContext = {
  apply?: () => void | Promise<void>
  applyNow?: () => void | Promise<void>
  review?: () => void | Promise<void>
  dictate?: () => void | Promise<void>
  edit?: () => void | Promise<void>
  reset?: () => void | Promise<void>
  choose?: (choiceId?: string) => void | Promise<void>
  openOrders?: () => void | Promise<void>
  exit?: () => void | Promise<void>
}

export function createWorkshopCommandActions<
  TRecord extends WorkshopCommandActionRecord = WorkshopCommandActionRecord,
>(
  t: TFunction<'workshop'>,
): EntityActionDefinition<TRecord, WorkshopCommandActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.workshopCommandApply,
      kind: 'run',
      label: t('command.apply'),
      icon: Check,
      isAllowedForRole: canApplyWorkshopCommand,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.apply?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.workshopCommandApplyNow,
      kind: 'run',
      label: t('command.applyNow'),
      icon: CheckCircle2,
      isAllowedForRole: canApplyWorkshopCommand,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.applyNow?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.workshopCommandReview,
      kind: 'run',
      label: t('command.review'),
      icon: Clock,
      isAllowedForRole: canUseWorkshopCommand,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.review?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.workshopCommandDictate,
      kind: 'run',
      label: t('command.record'),
      icon: Mic,
      isAllowedForRole: canUseWorkshopCommand,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.dictate?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.workshopCommandEdit,
      kind: 'run',
      label: t('command.editSentence'),
      icon: Pencil,
      isAllowedForRole: canUseWorkshopCommand,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.edit?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.workshopCommandReset,
      kind: 'run',
      label: t('command.reset'),
      icon: RotateCcw,
      isAllowedForRole: canUseWorkshopCommand,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.reset?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.workshopCommandChoose,
      kind: 'run',
      label: t('command.choose'),
      icon: HelpCircle,
      isAllowedForRole: canUseWorkshopCommand,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.choose?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.workshopCommandOpenOrders,
      kind: 'navigate',
      label: t('command.openOrders'),
      icon: ExternalLink,
      isAllowedForRole: canOpenWorkshopOrder,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.openOrders?.()
      },
    },
    {
      id: ENTITY_ACTION_IDS.workshopCommandExit,
      kind: 'run',
      label: t('command.backToSearch'),
      icon: ArrowLeft,
      isAllowedForRole: canUseWorkshopCommand,
      isEnabled: () => true,
      run: (_record, context) => {
        void context.exit?.()
      },
    },
  ]
}

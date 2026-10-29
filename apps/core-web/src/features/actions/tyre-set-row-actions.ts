import type { TFunction } from 'i18next'
import { Ruler } from 'lucide-react'
import type { NavigateFunction } from 'react-router-dom'

import type { TyreSet } from '@/api/tyre-storage'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { canRecordTyreMeasurement } from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

export type TyreSetRowActionContext = {
  navigate: NavigateFunction
  currentSearch?: string
}

export function createTyreSetTyreMeasurementAction(
  t: TFunction<'workshop'>,
): EntityActionDefinition<TyreSet, TyreSetRowActionContext> {
  return {
    id: ENTITY_ACTION_IDS.tyreSetRecordTyreMeasurement,
    kind: 'navigate',
    label: t('tyreReport.record'),
    icon: Ruler,
    isAllowedForRole: canRecordTyreMeasurement,
    isEnabled: (record) => Boolean(record.vehicleId),
    run: (record, { navigate, currentSearch }) => {
      const search = new URLSearchParams(currentSearch)
      search.set('action', 'recordTyreMeasurement')
      navigate(`${APP_ROUTE_PATHS.tyreStorageDetail.replace(':id', record.id)}?${search}`)
    },
  }
}

import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'

import type { WorkshopEstimateListRow, WorkshopEstimateVersionDetail } from '@/api/workshop-estimates'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { canOpenEstimate } from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

/** What the registry actions read of an estimate version: shared by list rows and the command palette. */
export type EstimateActionRecord = Pick<WorkshopEstimateListRow, 'version_id' | 'estimate_number' | 'version' | 'order_id'> & {
  id: string
}

/** A list row keyed by the estimate version, which is the id the registry and the table use. */
export type EstimateListRow = WorkshopEstimateListRow & { id: string }

export function estimateVersionToActionRecord(version: WorkshopEstimateVersionDetail): EstimateActionRecord {
  return {
    id: version.id,
    version_id: version.id,
    estimate_number: version.estimate_number,
    version: version.version,
    order_id: version.workshop_order_id,
  }
}

export function toEstimateListRow(row: WorkshopEstimateListRow): EstimateListRow {
  return { ...row, id: row.version_id }
}

/** The work order, scrolled to the estimate version of the row. */
export function getEstimateRowHref(row: Pick<EstimateActionRecord, 'order_id' | 'version'>): string {
  return `${APP_ROUTE_PATHS.workshopOrderDetail.replace(':id', row.order_id)}#estimate-version-${row.version}`
}

export type EstimateRowActionContext = {
  navigate: NavigateFunction
}

export function createEstimateRowActions<TRecord extends EstimateActionRecord>(
  t: TFunction<'workshop'>,
): EntityActionDefinition<TRecord, EstimateRowActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.estimateOpen,
      kind: 'navigate',
      label: t('estimateList.actions.open'),
      icon: ExternalLink,
      shortcutKey: 'o',
      isAllowedForRole: canOpenEstimate,
      isEnabled: () => true,
      run: (row, { navigate }) => {
        navigate(getEstimateRowHref(row))
      },
    },
  ]
}

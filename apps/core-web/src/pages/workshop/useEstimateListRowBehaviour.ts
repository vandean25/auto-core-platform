import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { canOpenEstimate } from '@/features/actions/action-role-predicates'
import {
  createEstimateRowActions,
  getEstimateRowHref,
  type EstimateListRow,
} from '@/features/actions/estimate-row-actions'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { useRegistryRowBehaviour } from '@/features/actions/use-registry-row-behaviour'
import { useRegistryRowShortcuts } from '@/features/shortcuts/use-registry-row-shortcuts'

/** Row click, link, context menu and `o` shortcut of the estimates list, all from the registry. */
export function useEstimateListRowBehaviour(records: EstimateListRow[]) {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const role = useAuthRole()

  const definitions = useMemo(() => createEstimateRowActions(t), [t])
  const runContext = useMemo(() => ({ navigate }), [navigate])

  const tableBehaviour = useMemo(
    () => ({
      getRowHref: (row: EstimateListRow) => (canOpenEstimate(role) ? getEstimateRowHref(row) : undefined),
      getRowAccessibleName: (row: EstimateListRow) =>
        t('estimateList.rowAria', { number: row.estimate_number, version: row.version }),
      onRowClick: (row: EstimateListRow) => {
        if (canOpenEstimate(role)) navigate(getEstimateRowHref(row))
      },
    }),
    [navigate, role, t],
  )

  useRegistryRowShortcuts({ role, definitions, runContext, records })

  return useRegistryRowBehaviour({ role, definitions, runContext, tableBehaviour })
}

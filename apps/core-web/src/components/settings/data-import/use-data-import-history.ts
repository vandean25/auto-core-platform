import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ColumnFiltersState, PaginationState, SortingState } from '@tanstack/react-table'

import {
  downloadImportErrorRowsCsv,
  IMPORT_JOBS_PAGE_LIMIT,
  useCancelImportJob,
  useImportJobs,
  type ImportJobListItem,
} from '@/api/imports'
import { useTenantMembers } from '@/api/tenant-members'
import { useAuthRole } from '@/features/actions/use-auth-role'
import { useRegistryRowBehaviour } from '@/features/actions/use-registry-row-behaviour'
import {
  createImportJobRowActions,
  type ImportJobActionContext,
} from '@/features/actions/import-job-row-actions'
import { triggerBlobDownload } from '@/lib/download'
import { getErrorMessage } from '@/lib/error-utils'

import { createImportHistoryColumns } from './import-history-columns'

const HISTORY_POLL_MS = 5000

/** Import history table data, columns and registry row actions for the settings data-import tab. */
export function useDataImportHistory(openJob: (jobId: string) => void) {
  const { t, i18n } = useTranslation('settings')
  const role = useAuthRole()

  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: IMPORT_JOBS_PAGE_LIMIT,
  })
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [undoJobId, setUndoJobId] = React.useState<string | null>(null)

  const jobsQuery = useImportJobs({
    page: pagination.pageIndex + 1,
    limit: pagination.pageSize,
  })
  const membersQuery = useTenantMembers({ includeInactive: true, limit: 200 })

  const refetchJobs = jobsQuery.refetch
  const hasRunningJob = React.useMemo(
    () =>
      (jobsQuery.data?.data ?? []).some(
        (job) => job.status === 'APPLYING' || job.status === 'UNDOING',
      ),
    [jobsQuery.data],
  )

  React.useEffect(() => {
    if (!hasRunningJob) return
    const timer = setInterval(() => void refetchJobs(), HISTORY_POLL_MS)
    return () => clearInterval(timer)
  }, [hasRunningJob, refetchJobs])

  const userNames = React.useMemo(() => {
    const names = new Map<string, string>()
    for (const member of membersQuery.data?.data ?? []) {
      const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ')
      names.set(member.userId, fullName || member.email)
    }
    return names
  }, [membersQuery.data])

  const resolveUser = React.useCallback(
    (userId: string | null) =>
      (userId && userNames.get(userId)) || t('dataImport.history.anonymousUser'),
    [userNames, t],
  )

  const { mutate: cancelImportJob } = useCancelImportJob()

  const runContext = React.useMemo<ImportJobActionContext>(
    () => ({
      openJob,
      undoJob: (jobId) => setUndoJobId(jobId),
      cancelJob: (jobId) =>
        cancelImportJob(jobId, {
          onError: (error) => {
            toast.error(getErrorMessage(error, t('dataImport.toast.cancelFailed')))
          },
        }),
      downloadErrors: (jobId) => {
        downloadImportErrorRowsCsv(jobId, i18n.language)
          .then((blob) => triggerBlobDownload(blob, `import-${jobId}-errors.csv`))
          .catch((error) => {
            toast.error(getErrorMessage(error, t('dataImport.toast.errorCsvFailed')))
          })
      },
    }),
    [openJob, cancelImportJob, i18n.language, t],
  )

  const definitions = React.useMemo(
    () => createImportJobRowActions<ImportJobListItem>(t),
    [t],
  )

  const tableBehaviour = React.useMemo(
    () => ({
      onRowClick: (row: { id: string }) => openJob(row.id),
      getRowAccessibleName: (row: { file_name: string }) =>
        t('dataImport.history.rowAria', { file: row.file_name }),
    }),
    [openJob, t],
  )

  const rowBehaviour = useRegistryRowBehaviour({ role, definitions, runContext, tableBehaviour })
  const columns = React.useMemo(
    () => createImportHistoryColumns(t, { resolveUser }),
    [t, resolveUser],
  )

  const rows = jobsQuery.data?.data ?? []
  const pageCount = jobsQuery.data
    ? Math.ceil(jobsQuery.data.meta.total / pagination.pageSize)
    : -1

  return {
    columns,
    rows,
    pageCount,
    isLoading: jobsQuery.isLoading,
    isError: jobsQuery.isError,
    rowBehaviour,
    pagination,
    setPagination,
    sorting,
    setSorting,
    columnFilters,
    setColumnFilters,
    undoJobId,
    setUndoJobId,
  }
}

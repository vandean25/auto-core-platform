import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { format } from 'date-fns'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { AttendancePunchBar } from '@/components/hr/AttendancePunchBar'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { useMechanicQueue } from '@/api/mechanic'
import type { MechanicQueueItem } from '@/api/mechanic'
import { useHrMeClock, usePunchClock } from '@/api/hr'
import type { PunchClockPayload } from '@/api/hr'
import { getErrorMessage, getErrorStatus } from '@/lib/error-utils'

// ─── Queue Row ────────────────────────────────────────────────────────────────

interface QueueRow {
  taskId: string
  seq: number
  title: string
  vehicle: string
  status: MechanicQueueItem['taskStatus']
  scheduledDate: string | null
}

// ─── Queue Page ───────────────────────────────────────────────────────────────

export default function MechanicQueuePage() {
  const navigate = useNavigate()

  const { data: queueResponse, isLoading, refetch } = useMechanicQueue()
  const { data: clockResponse, error: clockError } = useHrMeClock()
  const { mutate: punchClock, isPending: isPunchPending } = usePunchClock()

  useEffect(() => {
    if (!clockError || getErrorStatus(clockError) === 403) return

    toast.error(getErrorMessage(clockError, 'Failed to load attendance clock'))
  }, [clockError])

  const handlePunch = (type: PunchClockPayload['type']) => {
    punchClock(
      { type },
      {
        onError: (error) => {
          toast.error(getErrorMessage(error, 'Failed to punch attendance clock'))
        },
      },
    )
  }

  const { queryParams, ...tableState } = useDataTableQuery({ defaultPageSize: 25 })

  const rows = useMemo<QueueRow[]>(() => {
    const items = queueResponse?.data ?? []
    const filtered = queryParams.search
      ? items.filter((item) => {
          const needle = queryParams.search!.toLowerCase()
          return (
            item.taskTitle.toLowerCase().includes(needle) ||
            item.orderNumber.toLowerCase().includes(needle) ||
            `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}`
              .toLowerCase()
              .includes(needle)
          )
        })
      : items

    const mapped: QueueRow[] = filtered.map((item) => ({
      taskId: item.taskId,
      seq: item.sequence,
      title: item.taskTitle,
      vehicle: `${item.vehicle.year} ${item.vehicle.make} ${item.vehicle.model}`,
      status: item.taskStatus,
      scheduledDate: item.scheduledDate ?? null,
    }))

    const { sortField, sortDirection } = queryParams
    if (!sortField) return mapped

    return [...mapped].sort((a, b) => {
      const aVal = a[sortField as keyof QueueRow] ?? ''
      const bVal = b[sortField as keyof QueueRow] ?? ''
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true })
      return sortDirection === 'desc' ? -cmp : cmp
    })
  }, [queueResponse, queryParams])

  const columns: ColumnDef<QueueRow>[] = [
    {
      accessorKey: 'seq',
      header: ({ column }) => <DataTableColumnHeader column={column} title="#" />,
      cell: ({ row }) => (
        <span className="w-8 text-center font-mono text-sm font-semibold text-slate-500">
          {row.original.seq}
        </span>
      ),
      size: 48,
    },
    {
      accessorKey: 'title',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Task" />,
      cell: ({ row }) => (
        <span className="font-medium leading-tight">{row.original.title}</span>
      ),
    },
    {
      accessorKey: 'vehicle',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Vehicle" />,
      cell: ({ row }) => (
        <span className="text-slate-600">{row.original.vehicle}</span>
      ),
    },
    {
      accessorKey: 'scheduledDate',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Scheduled" />,
      cell: ({ row }) =>
        row.original.scheduledDate ? (
          <span className="text-slate-500 text-sm">
            {format(new Date(row.original.scheduledDate), 'PP')}
          </span>
        ) : (
          <span className="text-slate-400 text-sm">—</span>
        ),
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ]

  return (
    <div className="w-full max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Queue</h1>
          <p className="text-slate-500">Your active work orders — tap a task to open it.</p>
        </div>
        <div className="flex items-center gap-2">
          {clockResponse && getErrorStatus(clockError) !== 403 ? (
            <AttendancePunchBar
              state={clockResponse.state}
              pending={isPunchPending}
              size="compact"
              onPunch={handlePunch}
            />
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            aria-label="Refresh queue"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        pageCount={1}
        isLoading={isLoading}
        searchPlaceholder="Search tasks, vehicles…"
        onRowClick={(row) => navigate(`/mechanic/tasks/${row.taskId}`)}
        {...tableState}
      />
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { format } from 'date-fns'
import { RefreshCw, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { useMechanicQueue } from '@/api/mechanic'
import type { MechanicQueueItem } from '@/api/mechanic'
import { useEmployees } from '@/api/employees'

const MECHANIC_ID_KEY = 'acp:mechanic-id'

function readStoredMechanicId(): string {
  try {
    return window.localStorage.getItem(MECHANIC_ID_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeStoredMechanicId(id: string): void {
  try {
    // Validate UUID format before storing to prevent persisting unexpected values
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return
    window.localStorage.setItem(MECHANIC_ID_KEY, id)
  } catch {
    // ignore storage errors
  }
}

// ─── Mechanic Picker ─────────────────────────────────────────────────────────

interface MechanicPickerProps {
  onSelect: (mechanicId: string) => void
}

function MechanicPicker({ onSelect }: MechanicPickerProps) {
  const { data: employeesResponse, isLoading } = useEmployees({ role: 'MECHANIC', limit: 100 })
  const mechanics = employeesResponse?.data?.filter((e) => e.isActive) ?? []

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <Wrench className="h-10 w-10 text-slate-400" />
        <h2 className="text-xl font-semibold tracking-tight">Select Your Profile</h2>
        <p className="text-slate-500">Tap your name to load your task queue.</p>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading mechanics…</p>
      ) : mechanics.length === 0 ? (
        <p className="text-sm text-slate-500">No active mechanics found for this tenant.</p>
      ) : (
        <div className="grid w-full max-w-md gap-3">
          {mechanics.map((mechanic) => (
            <button
              key={mechanic.id}
              type="button"
              onClick={() => onSelect(mechanic.id)}
              className="flex min-h-[56px] items-center rounded-lg border border-slate-200 bg-white px-5 py-3 text-left text-base font-medium shadow-sm transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              {mechanic.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
  const [mechanicId, setMechanicId] = useState<string>(() => readStoredMechanicId())

  const { data: queueResponse, isLoading, refetch } = useMechanicQueue(mechanicId)

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

  const handleSelectMechanic = (id: string) => {
    writeStoredMechanicId(id)
    setMechanicId(id)
  }

  if (!mechanicId) {
    return <MechanicPicker onSelect={handleSelectMechanic} />
  }

  return (
    <div className="w-full max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Queue</h1>
          <p className="text-slate-500">Your active work orders — tap a task to open it.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            aria-label="Refresh queue"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              writeStoredMechanicId('')
              setMechanicId('')
            }}
          >
            Switch Mechanic
          </Button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        pageCount={1}
        isLoading={isLoading}
        searchPlaceholder="Search tasks, vehicles…"
        onRowClick={(row) =>
          navigate(`/mechanic/tasks/${row.taskId}?mechanicId=${encodeURIComponent(mechanicId)}`)
        }
        {...tableState}
      />
    </div>
  )
}

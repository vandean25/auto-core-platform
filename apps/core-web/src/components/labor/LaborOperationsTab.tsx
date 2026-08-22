import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { ColumnFiltersState } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useLaborOperations, useLaborCategories, useDeleteLaborOperation, flattenLaborCategories } from '@/api/labor'
import type { LaborOperation } from '@/api/labor'
import { LaborOperationFormDialog } from './LaborOperationFormDialog'

export function LaborOperationsTab() {
  const { queryParams, columnFilters, setColumnFilters, ...tableState } = useDataTableQuery({
    defaultPageSize: 10,
  })
  const { data: responseData, isLoading } = useLaborOperations(queryParams)
  const { data: categoriesData } = useLaborCategories()
  const deleteMutation = useDeleteLaborOperation()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [editingOperation, setEditingOperation] = React.useState<LaborOperation | null>(null)
  const [deactivatingId, setDeactivatingId] = React.useState<string | null>(null)

  const data = responseData?.data ?? []
  const totalPages = responseData?.meta?.totalPages ?? 1

  // ── Category filter ────────────────────────────────────────────────────────
  const categoryFilterValue = columnFilters.find((f) => f.id === 'categoryId')?.value as
    | string
    | undefined

  const handleCategoryFilter = (value: string) => {
    setColumnFilters((prev: ColumnFiltersState) => {
      const without = prev.filter((f) => f.id !== 'categoryId')
      if (value === '_all') return without
      return [...without, { id: 'categoryId', value }]
    })
  }

  // ── Soft delete (Deactivate) ───────────────────────────────────────────────
  const handleDeactivate = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id)
      toast.success('Labor operation deactivated')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to deactivate labor operation'
      toast.error(message)
    } finally {
      setDeactivatingId(null)
    }
  }

  // ── Flat categories for dropdown ───────────────────────────────────────────
  const categories = React.useMemo(
    () => flattenLaborCategories(categoriesData),
    [categoriesData]
  )

  // ── Columns ────────────────────────────────────────────────────────────────
  const columns = React.useMemo<ColumnDef<LaborOperation>[]>(
    () => [
      {
        accessorKey: 'code',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Code" />,
        cell: ({ row }) => <span className="font-mono text-sm font-medium">{row.original.code}</span>,
      },
      {
        accessorKey: 'description',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Description" />,
      },
      {
        accessorKey: 'standardAw',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Standard AW" />,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.standardAw.toFixed(2)} hrs</span>
        ),
      },
      {
        accessorKey: 'hourlyRate',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Hourly Rate" />,
        cell: ({ row }) => (
          <span className="tabular-nums">${row.original.hourlyRate.toFixed(2)}</span>
        ),
      },
      {
        id: 'category',
        accessorFn: (row) => row.category?.name ?? '',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Category" />,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.category?.name ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'isActive',
        header: ({ column }) => <DataTableColumnHeader column={column} title="Active" />,
        enableSorting: false,
        cell: ({ row }) => <StatusBadge status={row.original.isActive ? 'ACTIVE' : 'INACTIVE'} />,
      },
    ],
    []
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Labor Operations</h3>
          <p className="text-sm text-muted-foreground">
            Manage standard labor operations and their allocated work rates.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Labor Operation
        </Button>
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-2">
        <Select value={categoryFilterValue ?? '_all'} onValueChange={handleCategoryFilter}>
          <SelectTrigger className="h-8 w-[200px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={data}
        pageCount={totalPages}
        isLoading={isLoading}
        searchPlaceholder="Search by code or description..."
        columnFilters={columnFilters}
        setColumnFilters={setColumnFilters}
        onRowClick={(row) => setEditingOperation(row)}
        getRowContextActions={(row) => [
          {
            label: 'Deactivate',
            onClick: () => setDeactivatingId(row.id),
            destructive: true,
          },
        ]}
        {...tableState}
      />

      {/* Deactivation Confirmation */}
      <AlertDialog
        open={!!deactivatingId}
        onOpenChange={(open) => !open && setDeactivatingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the labor operation. It will no longer be available for new
              workshop orders but historical data will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deactivatingId && void handleDeactivate(deactivatingId)}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Create dialog */}
      <LaborOperationFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Edit dialog */}
      <LaborOperationFormDialog
        open={!!editingOperation}
        onOpenChange={(open) => {
          if (!open) setEditingOperation(null)
        }}
        operation={editingOperation}
      />
    </div>
  )
}

import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { toast } from 'sonner'

import { type Bay, useBays, useCreateBay, useDeleteBay, useUpdateBay } from '@/api/bays'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { getErrorMessage } from '@/lib/error-utils'

type BayFormState = {
  name: string
  sortOrder: string
}

const defaultFormState: BayFormState = {
  name: '',
  sortOrder: '0',
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

function matchesBaySearch(bay: Bay, term: string) {
  if (!term) return true

  const haystack = [
    bay.name,
    bay.isActive ? 'active' : 'inactive',
    String(bay.sortOrder),
  ]

  return haystack.some((entry) => entry.toLowerCase().includes(term))
}

function sortBays(
  bays: Bay[],
  sortField?: string,
  sortDirection: 'asc' | 'desc' = 'asc',
) {
  if (!sortField) return bays

  const direction = sortDirection === 'desc' ? -1 : 1

  return [...bays].sort((left, right) => {
    if (sortField === 'name') {
      return direction * left.name.localeCompare(right.name)
    }

    if (sortField === 'isActive') {
      return direction * ((Number(left.isActive)) - (Number(right.isActive)))
    }

    if (sortField === 'sortOrder') {
      return direction * (left.sortOrder - right.sortOrder)
    }

    return 0
  })
}

export function BaySettingsTab() {
  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })

  const { data: responseData, isLoading } = useBays({
    includeInactive: true,
    limit: 100,
  })
  const createMutation = useCreateBay()
  const updateMutation = useUpdateBay()
  const deleteMutation = useDeleteBay()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [formState, setFormState] = React.useState<BayFormState>(defaultFormState)

  const bays = React.useMemo(() => responseData?.data ?? [], [responseData?.data])

  const filteredBays = React.useMemo(() => {
    const term = normalizeSearch(queryParams.search ?? '')
    return bays.filter((bay) => matchesBaySearch(bay, term))
  }, [bays, queryParams.search])

  const sortedBays = React.useMemo(
    () => sortBays(filteredBays, queryParams.sortField, queryParams.sortDirection),
    [filteredBays, queryParams.sortDirection, queryParams.sortField],
  )

  const pageSize = queryParams.pageSize
  const pageCount = Math.max(1, Math.ceil(sortedBays.length / pageSize))
  const currentPage = Math.min(queryParams.page, pageCount)

  React.useEffect(() => {
    if (queryParams.page <= pageCount) return

    setPagination((previous) => ({
      ...previous,
      pageIndex: pageCount - 1,
    }))
  }, [pageCount, queryParams.page, setPagination])

  const pageStart = (currentPage - 1) * pageSize
  const pagedBays = sortedBays.slice(pageStart, pageStart + pageSize)

  const runUpdate = React.useCallback(
    async (
      id: string,
      data: {
        name?: string
        isActive?: boolean
        sortOrder?: number
      },
      successMessage: string,
      fallbackMessage: string,
    ) => {
      try {
        await updateMutation.mutateAsync({ id, data })
        toast.success(successMessage)
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, fallbackMessage))
        throw error
      }
    },
    [updateMutation],
  )

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()

    const normalizedName = formState.name.trim()
    if (!normalizedName) {
      toast.error('Bay name is required')
      return
    }

    const parsedSortOrder = Number(formState.sortOrder)
    if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
      toast.error('Sort order must be a non-negative integer')
      return
    }

    try {
      await createMutation.mutateAsync({
        name: normalizedName,
        sortOrder: parsedSortOrder,
        isActive: true,
      })

      toast.success('Bay created')
      setFormState(defaultFormState)
      setCreateOpen(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to create bay'))
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const result = await deleteMutation.mutateAsync(id)
      if (result.deleted) {
        toast.success('Bay deleted')
        return
      }

      toast.success('Bay deactivated')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to delete bay'))
    }
  }

  const columns = React.useMemo<ColumnDef<Bay>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
        cell: ({ row }) => (
          <InlineEdit
            value={row.original.name}
            onSave={async (nextName) => {
              const normalizedName = nextName.trim()
              if (!normalizedName) {
                toast.error('Bay name is required')
                throw new Error('Bay name is required')
              }

              await runUpdate(
                row.original.id,
                { name: normalizedName },
                'Bay updated',
                'Failed to update bay name',
              )
            }}
          />
        ),
      },
      {
        accessorKey: 'isActive',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Active' />,
        cell: ({ row }) => (
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              void runUpdate(
                row.original.id,
                { isActive: !row.original.isActive },
                row.original.isActive ? 'Bay deactivated' : 'Bay activated',
                'Failed to update bay status',
              )
            }}
          >
            {row.original.isActive ? 'Active' : 'Inactive'}
          </Button>
        ),
      },
      {
        accessorKey: 'sortOrder',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Sort Order' />,
        cell: ({ row }) => (
          <InlineEdit
            value={String(row.original.sortOrder)}
            onSave={async (nextSortOrder) => {
              const parsedSortOrder = Number(nextSortOrder.trim())
              if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
                toast.error('Sort order must be a non-negative integer')
                throw new Error('Sort order must be a non-negative integer')
              }

              await runUpdate(
                row.original.id,
                { sortOrder: parsedSortOrder },
                'Bay sort order updated',
                'Failed to update bay sort order',
              )
            }}
          />
        ),
      },
    ],
    [runUpdate],
  )

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h3 className='text-lg font-medium'>Bays</h3>
          <p className='text-sm text-muted-foreground'>Manage workshop service bays and their ordering.</p>
        </div>
        <Button type='button' onClick={() => setCreateOpen(true)}>+ Bay</Button>
      </div>

      <DataTable
        columns={columns}
        data={pagedBays}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder='Search bays...'
        setPagination={setPagination}
        getRowContextActions={(row) => [
          {
            label: 'Delete',
            destructive: true,
            onClick: () => {
              void handleDelete(row.id)
            },
          },
        ]}
        {...tableState}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Bay</DialogTitle>
            <DialogDescription>Add a physical workshop bay.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='bay-name'>Name</Label>
              <Input
                id='bay-name'
                value={formState.name}
                onChange={(event) => {
                  setFormState((previous) => ({ ...previous, name: event.target.value }))
                }}
                placeholder='Bay name'
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='bay-sort-order'>Sort Order</Label>
              <Input
                id='bay-sort-order'
                type='number'
                min={0}
                step={1}
                value={formState.sortOrder}
                onChange={(event) => {
                  setFormState((previous) => ({ ...previous, sortOrder: event.target.value }))
                }}
              />
            </div>

            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type='submit' disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Saving...' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

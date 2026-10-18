import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
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

function matchesBaySearch(bay: Bay, term: string, t: TFunction<'settings'>) {
  if (!term) return true

  const haystack = [
    bay.name,
    bay.isActive ? t('bays.search.active') : t('bays.search.inactive'),
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
  const { t } = useTranslation(['settings', 'common'])
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
    return bays.filter((bay) => matchesBaySearch(bay, term, t))
  }, [bays, queryParams.search, t])

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
      toast.error(t('bays.toast.nameRequired'))
      return
    }

    const parsedSortOrder = Number(formState.sortOrder)
    if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
      toast.error(t('bays.toast.sortOrderInvalid'))
      return
    }

    try {
      await createMutation.mutateAsync({
        name: normalizedName,
        sortOrder: parsedSortOrder,
        isActive: true,
      })

      toast.success(t('bays.toast.created'))
      setFormState(defaultFormState)
      setCreateOpen(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('bays.toast.createFailed')))
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const result = await deleteMutation.mutateAsync(id)
      if (result.deleted) {
        toast.success(t('bays.toast.deleted'))
        return
      }

      toast.success(t('bays.toast.deactivated'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('bays.toast.deleteFailed')))
    }
  }

  const columns = React.useMemo<ColumnDef<Bay>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('bays.columns.name')} />,
        cell: ({ row }) => (
          <InlineEdit
            value={row.original.name}
            onSave={async (nextName) => {
              const normalizedName = nextName.trim()
              if (!normalizedName) {
                toast.error(t('bays.toast.nameRequired'))
                throw new Error(t('bays.toast.nameRequired'))
              }

              await runUpdate(
                row.original.id,
                { name: normalizedName },
                t('bays.toast.updated'),
                t('bays.toast.updateNameFailed'),
              )
            }}
          />
        ),
      },
      {
        accessorKey: 'isActive',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('bays.columns.active')} />,
        cell: ({ row }) => (
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              void runUpdate(
                row.original.id,
                { isActive: !row.original.isActive },
                row.original.isActive ? t('bays.toast.deactivated') : t('bays.toast.activated'),
                t('bays.toast.updateStatusFailed'),
              )
            }}
          >
            {row.original.isActive ? t('bays.active') : t('bays.inactive')}
          </Button>
        ),
      },
      {
        accessorKey: 'sortOrder',
        header: ({ column }) => <DataTableColumnHeader column={column} title={t('bays.columns.sortOrder')} />,
        cell: ({ row }) => (
          <InlineEdit
            value={String(row.original.sortOrder)}
            onSave={async (nextSortOrder) => {
              const parsedSortOrder = Number(nextSortOrder.trim())
              if (!Number.isInteger(parsedSortOrder) || parsedSortOrder < 0) {
                toast.error(t('bays.toast.sortOrderInvalid'))
                throw new Error(t('bays.toast.sortOrderInvalid'))
              }

              await runUpdate(
                row.original.id,
                { sortOrder: parsedSortOrder },
                t('bays.toast.sortOrderUpdated'),
                t('bays.toast.updateSortOrderFailed'),
              )
            }}
          />
        ),
      },
    ],
    [runUpdate, t],
  )

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-lg font-medium'>{t('bays.title')}</h2>
          <p className='text-sm text-muted-foreground'>{t('bays.description')}</p>
        </div>
        <Button type='button' onClick={() => setCreateOpen(true)}>{t('bays.createButton')}</Button>
      </div>

      <DataTable
        columns={columns}
        data={pagedBays}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder={t('bays.searchPlaceholder')}
        setPagination={setPagination}
        getRowContextActions={(row) => [
          {
            label: t('bays.delete'),
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
            <DialogTitle>{t('bays.dialog.title')}</DialogTitle>
            <DialogDescription>{t('bays.dialog.description')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='bay-name'>{t('bays.dialog.name')}</Label>
              <Input
                id='bay-name'
                value={formState.name}
                onChange={(event) => {
                  setFormState((previous) => ({ ...previous, name: event.target.value }))
                }}
                placeholder={t('bays.dialog.namePlaceholder')}
                required
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='bay-sort-order'>{t('bays.dialog.sortOrder')}</Label>
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
                {t('common:actions.cancel')}
              </Button>
              <Button type='submit' disabled={createMutation.isPending}>
                {createMutation.isPending ? t('bays.dialog.saving') : t('bays.dialog.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

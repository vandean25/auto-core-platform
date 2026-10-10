import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { format } from 'date-fns'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'

import {
  API_KEY_SCOPE_OPTIONS,
  type PublicApiScope,
  type TenantApiKey,
  type TenantApiKeyCreated,
  useCreateTenantApiKey,
  useRevokeTenantApiKey,
  useTenantApiKeys,
} from '@/api/api-keys'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

function formatDateTime(value: string | null | undefined, fallback: string) {
  return value ? format(new Date(value), 'yyyy-MM-dd HH:mm') : fallback
}

function sortApiKeys(keys: TenantApiKey[], field?: string, direction?: 'asc' | 'desc') {
  if (!field) return keys

  const valueOf = (key: TenantApiKey): string => {
    switch (field) {
      case 'name':
        return key.name.toLowerCase()
      case 'keyPrefix':
        return key.keyPrefix
      case 'status':
        return key.status
      case 'lastUsedAt':
        return key.lastUsedAt ?? ''
      case 'expiresAt':
        return key.expiresAt ?? ''
      default:
        return ''
    }
  }

  const factor = direction === 'asc' ? 1 : -1
  return [...keys].sort((left, right) => valueOf(left).localeCompare(valueOf(right)) * factor)
}

/**
 * Settings tab for tenant API keys (ADR-0026). Only OWNER and ADMIN see it (the page gates the tab). The
 * full key is shown exactly once, in the dialog that follows creation, and is never kept after it closes.
 */
export function ApiKeysSettingsTab() {
  const { queryParams, setPagination, ...tableState } = useDataTableQuery({ defaultPageSize: 10 })
  const { data: responseData, error, isLoading, refetch } = useTenantApiKeys()
  const createMutation = useCreateTenantApiKey()
  const revokeMutation = useRevokeTenantApiKey()

  const [createOpen, setCreateOpen] = React.useState(false)
  const [createName, setCreateName] = React.useState('')
  const [createScopes, setCreateScopes] = React.useState<PublicApiScope[]>([])
  const [createExpiresOn, setCreateExpiresOn] = React.useState('')
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [createdKey, setCreatedKey] = React.useState<TenantApiKeyCreated | null>(null)
  const [revokeTarget, setRevokeTarget] = React.useState<TenantApiKey | null>(null)

  const keys = React.useMemo(() => responseData?.data ?? [], [responseData?.data])

  const filteredKeys = React.useMemo(() => {
    const term = (queryParams.search ?? '').trim().toLowerCase()
    if (!term) return keys

    return keys.filter((key) =>
      [key.name, key.keyPrefix, key.status, key.createdByEmail ?? '', ...key.scopes]
        .some((value) => value.toLowerCase().includes(term)),
    )
  }, [keys, queryParams.search])

  const sortedKeys = React.useMemo(
    () => sortApiKeys(filteredKeys, queryParams.sortField, queryParams.sortDirection),
    [filteredKeys, queryParams.sortDirection, queryParams.sortField],
  )

  const pageSize = queryParams.pageSize
  const pageCount = Math.max(1, Math.ceil(sortedKeys.length / pageSize))
  const currentPage = Math.min(queryParams.page, pageCount)

  React.useEffect(() => {
    if (queryParams.page <= pageCount) return

    setPagination((previous) => ({
      ...previous,
      pageIndex: pageCount - 1,
    }))
  }, [pageCount, queryParams.page, setPagination])

  const pageStart = (currentPage - 1) * pageSize
  const pagedKeys = sortedKeys.slice(pageStart, pageStart + pageSize)

  const columns = React.useMemo<ColumnDef<TenantApiKey>[]>(
    () => [
      {
        id: 'name',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
        cell: ({ row }) => (
          <div>
            <div className='font-medium'>{row.original.name}</div>
            <div className='text-xs text-slate-500'>{row.original.createdByEmail ?? 'Unknown creator'}</div>
          </div>
        ),
      },
      {
        id: 'keyPrefix',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Key prefix' />,
        cell: ({ row }) => <code className='font-mono text-xs'>{`${row.original.keyPrefix}…`}</code>,
      },
      {
        id: 'scopes',
        header: 'Scopes',
        cell: ({ row }) => (
          <div className='flex flex-wrap gap-1'>
            {row.original.scopes.map((scope) => (
              <Badge key={scope} variant='outline'>
                {scope}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: 'status',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'lastUsedAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Last used' />,
        cell: ({ row }) => formatDateTime(row.original.lastUsedAt, 'Never'),
      },
      {
        id: 'expiresAt',
        header: ({ column }) => <DataTableColumnHeader column={column} title='Expires' />,
        cell: ({ row }) => formatDateTime(row.original.expiresAt, 'Never'),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.status === 'ACTIVE' ? (
            <Button variant='outline' size='sm' onClick={() => setRevokeTarget(row.original)}>
              Revoke
            </Button>
          ) : null,
      },
    ],
    [],
  )

  const resetCreateForm = () => {
    setCreateName('')
    setCreateScopes([])
    setCreateExpiresOn('')
    setCreateError(null)
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()

    const name = createName.trim()
    if (!name) {
      setCreateError('Enter a name for the key.')
      return
    }
    if (createScopes.length === 0) {
      setCreateError('Select at least one scope.')
      return
    }

    setCreateError(null)
    try {
      const created = await createMutation.mutateAsync({
        name,
        scopes: createScopes,
        ...(createExpiresOn ? { expiresAt: new Date(`${createExpiresOn}T23:59:59`).toISOString() } : {}),
      })
      setCreateOpen(false)
      setCreatedKey(created)
    } catch (mutationError) {
      setCreateError(getErrorMessage(mutationError, 'Failed to create API key'))
    }
  }

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token)
      toast.success('API key copied')
    } catch {
      toast.error('Copy failed. Select the key and copy it manually.')
    }
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return

    try {
      await revokeMutation.mutateAsync(revokeTarget.id)
      toast.success('API key revoked')
      setRevokeTarget(null)
    } catch (mutationError) {
      toast.error(getErrorMessage(mutationError, 'Failed to revoke API key'))
    }
  }

  const todayIso = new Date().toISOString().slice(0, 10)

  return (
    <div className='space-y-6'>
      <div className='flex items-start justify-between gap-4'>
        <div>
          <h3 className='text-lg font-medium'>API keys</h3>
          <p className='text-sm text-slate-500'>
            Read-only keys for integrations. Each key works only for the scopes you grant and has its own request budget.
          </p>
        </div>
        <Button
          onClick={() => {
            resetCreateForm()
            setCreateOpen(true)
          }}
        >
          + API key
        </Button>
      </div>

      {error ? (
        <div className='rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700'>
          <div className='flex items-center justify-between gap-4'>
            <span>{getErrorMessage(error, 'Failed to load API keys')}</span>
            <Button variant='outline' size='sm' onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={pagedKeys}
        pageCount={pageCount}
        isLoading={isLoading}
        searchPlaceholder='Search API keys...'
        emptyStateMessage='No API keys yet. Create one to connect an integration.'
        setPagination={setPagination}
        {...tableState}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>Choose a name and the read scopes this key may use.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='api-key-name'>Name</Label>
              <Input
                id='api-key-name'
                value={createName}
                maxLength={120}
                placeholder='Warehouse dashboard'
                onChange={(event) => setCreateName(event.target.value)}
              />
            </div>

            <fieldset className='space-y-3'>
              <legend className='text-sm font-medium'>Scopes</legend>
              {API_KEY_SCOPE_OPTIONS.map((option) => {
                const checkboxId = `api-key-scope-${option.value}`
                return (
                  <div key={option.value} className='flex items-start gap-3'>
                    <Checkbox
                      id={checkboxId}
                      checked={createScopes.includes(option.value)}
                      onCheckedChange={(checked) =>
                        setCreateScopes((previous) =>
                          checked === true
                            ? [...previous, option.value]
                            : previous.filter((scope) => scope !== option.value),
                        )
                      }
                    />
                    <div>
                      <Label htmlFor={checkboxId}>{option.label}</Label>
                      <p className='text-xs text-slate-500'>
                        {option.description} <code>{option.value}</code>
                      </p>
                    </div>
                  </div>
                )
              })}
            </fieldset>

            <div className='space-y-2'>
              <Label htmlFor='api-key-expires'>Expires on (optional)</Label>
              <Input
                id='api-key-expires'
                type='date'
                min={todayIso}
                value={createExpiresOn}
                onChange={(event) => setCreateExpiresOn(event.target.value)}
              />
            </div>

            {createError ? (
              <p role='alert' className='text-sm text-rose-600'>
                {createError}
              </p>
            ) : null}

            <DialogFooter>
              <Button type='submit' disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating…' : 'Create key'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createdKey !== null} onOpenChange={(open) => { if (!open) setCreatedKey(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your new API key</DialogTitle>
            <DialogDescription>
              This is the only time the full key is shown. Store it in your integration&apos;s secret store now.
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='api-key-token'>API key</Label>
            <div className='flex gap-2'>
              <Input
                id='api-key-token'
                readOnly
                value={createdKey?.token ?? ''}
                className='font-mono text-xs'
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type='button'
                variant='outline'
                onClick={() => {
                  if (createdKey) void copyToken(createdKey.token)
                }}
              >
                <Copy className='mr-2 h-4 w-4' aria-hidden='true' />
                Copy
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => { if (!open) setRevokeTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API key?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${revokeTarget?.name ?? ''}" stops working immediately. Integrations that use it get 401 on their next request. This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revokeMutation.isPending}
              onClick={(event) => {
                event.preventDefault()
                void handleRevoke()
              }}
            >
              Revoke key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

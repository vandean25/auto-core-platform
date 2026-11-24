import type { components } from '@/api/generated/openapi'
import type { ColumnFiltersState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { format } from 'date-fns'
import type { TFunction } from 'i18next'
import { Button } from '@/components/ui/button'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
import { ENTITY_ACTION_IDS } from '@/features/actions/entity-action'
import { cn } from '@/lib/utils'
import {
  PickerlContactCell,
  PickerlPhoneCell,
  type PickerlContactChannel,
} from './PickerlContactCell'
import { DEFAULT_OLDER_THAN_DAYS, type ContactedFilter } from './PickerlDueFilters'

export type PickerlDueRow = {
  id: string
  plate: string
  vehicle: string
  customer: string
  dueMonth: string
  status: string
  lastInspection: string | null
  lastContactedAt: string | null
  lastContactChannel: PickerlContactChannel | null
  lastContactBy: string | null
  phoneConsentAllowed: boolean
  phone: string
  email: string
  openPickerlOrder: { id: string; order_number: string } | null
}

export type PickerlDueQueryParams = {
  window?: 30 | 60 | 90
  status?: string
  contacted?: ContactedFilter
  contactedDays?: number
  page?: number
  pageSize?: number
}

export function buildPickerlDueQueryParams(
  tableQueryParams: { page?: number; pageSize?: number },
  columnFilters: ColumnFiltersState,
): PickerlDueQueryParams {
  const params: PickerlDueQueryParams = {
    page: tableQueryParams.page,
    pageSize: tableQueryParams.pageSize,
  }
  const windowFilter = columnFilters.find((f) => f.id === 'window')
  if (windowFilter?.value) {
    params.window = Number(windowFilter.value) as 30 | 60 | 90
  }
  const statusFilter = columnFilters.find((f) => f.id === 'status')
  if (statusFilter?.value) {
    params.status = statusFilter.value as string
  }
  const contactedFilter = columnFilters.find((f) => f.id === 'contacted')
  if (contactedFilter?.value) {
    params.contacted = contactedFilter.value as ContactedFilter
    if (params.contacted === 'older_than') {
      const daysFilter = columnFilters.find((f) => f.id === 'contactedDays')
      const parsedDays = Number(daysFilter?.value)
      params.contactedDays =
        Number.isFinite(parsedDays) && parsedDays > 0
          ? parsedDays
          : DEFAULT_OLDER_THAN_DAYS
    }
  }
  return params
}

function formatCustomerName(
  customer: components['schemas']['VehicleResponseDto']['customer'],
): string {
  if (!customer) return ''
  if (customer.type === 'COMPANY' && customer.company_name) {
    return customer.company_name
  }
  return `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim()
}

export function mapPickerlDueRow(
  vehicle: components['schemas']['VehicleResponseDto'],
  emDash: string,
): PickerlDueRow {
  const pickerlDue = (vehicle.pickerl_due ?? {}) as Record<string, unknown>
  const lastInspectedOn = pickerlDue.last_inspected_on as string | null | undefined
  const dueMonthRaw = pickerlDue.due_month as string | null | undefined

  return {
    id: vehicle.id,
    plate: vehicle.plate || '',
    vehicle: `${vehicle.make} ${vehicle.model}`,
    customer: formatCustomerName(vehicle.customer),
    dueMonth: dueMonthRaw ? String(dueMonthRaw) : emDash,
    status: (pickerlDue.status as string) || 'UNKNOWN',
    lastInspection: lastInspectedOn
      ? format(new Date(`${lastInspectedOn}T00:00:00.000Z`), 'PP')
      : null,
    lastContactedAt: vehicle.last_contacted_at ?? null,
    lastContactChannel:
      (vehicle.last_contact_channel as PickerlContactChannel | null | undefined) ?? null,
    lastContactBy: vehicle.last_contact_by ?? null,
    phoneConsentAllowed: Boolean(vehicle.phone_consent_allowed),
    phone: vehicle.customer?.phone || '',
    email: vehicle.customer?.email || '',
    openPickerlOrder: vehicle.open_pickerl_order ?? null,
  }
}

export function buildPickerlDueColumns({
  t,
  emDash,
  canManagePickerl,
  onRecordContact,
  onRecordPickerl,
  onOpenOrder,
  onCreateOrder,
}: {
  t: TFunction<'vehicles'>
  emDash: string
  canManagePickerl: boolean
  onRecordContact: (row: PickerlDueRow) => void
  onRecordPickerl: (vehicleId: string) => void
  onOpenOrder: (orderId: string) => void
  onCreateOrder: (vehicleId: string) => void
}): ColumnDef<PickerlDueRow>[] {
  const dim = (row: PickerlDueRow) =>
    cn(!row.phoneConsentAllowed && 'text-muted-foreground opacity-60')

  return [
    {
      accessorKey: 'plate',
      enableSorting: false,
      meta: { mobile: 'title' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('pickerlDue.columns.plate')} />
      ),
      cell: ({ row }) => <span className={dim(row.original)}>{row.original.plate}</span>,
    },
    {
      accessorKey: 'vehicle',
      enableSorting: false,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('pickerlDue.columns.vehicle')} />
      ),
      cell: ({ row }) => <span className={dim(row.original)}>{row.original.vehicle}</span>,
    },
    {
      accessorKey: 'customer',
      enableSorting: false,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('pickerlDue.columns.customer')} />
      ),
      cell: ({ row }) => <span className={dim(row.original)}>{row.original.customer}</span>,
    },
    {
      accessorKey: 'dueMonth',
      enableSorting: false,
      meta: { mobile: 'trailing' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('pickerlDue.columns.dueMonth')} />
      ),
      cell: ({ row }) => <span className={dim(row.original)}>{row.original.dueMonth}</span>,
    },
    {
      accessorKey: 'status',
      enableSorting: false,
      meta: { mobile: 'status' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('pickerlDue.columns.status')} />
      ),
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status as 'UNKNOWN' | 'OK' | 'DUE_SOON' | 'OVERDUE'}
        />
      ),
    },
    {
      accessorKey: 'lastInspection',
      enableSorting: false,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('pickerlDue.columns.lastInspection')} />
      ),
      cell: ({ row }) => (
        <span className={dim(row.original)}>{row.original.lastInspection ?? emDash}</span>
      ),
    },
    {
      id: 'lastContact',
      enableSorting: false,
      meta: { mobile: 'subtitle' },
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('pickerlDue.columns.lastContact')} />
      ),
      cell: ({ row }) => (
        <PickerlContactCell
          contactedAt={row.original.lastContactedAt}
          channel={row.original.lastContactChannel}
          actorName={row.original.lastContactBy}
          emDash={emDash}
          dimmed={!row.original.phoneConsentAllowed}
        />
      ),
    },
    {
      accessorKey: 'phone',
      enableSorting: false,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('pickerlDue.columns.phone')} />
      ),
      cell: ({ row }) => (
        <PickerlPhoneCell
          phone={row.original.phone}
          phoneConsentAllowed={row.original.phoneConsentAllowed}
          emDash={emDash}
        />
      ),
    },
    {
      accessorKey: 'email',
      enableSorting: false,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('pickerlDue.columns.email')} />
      ),
      cell: ({ row }) => <span className={dim(row.original)}>{row.original.email}</span>,
    },
    {
      id: 'actions',
      enableSorting: false,
      cell: ({ row }) => (
        <div
          className="flex justify-end gap-2"
          role="presentation"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.key === 'Enter' && e.stopPropagation()}
        >
          {canManagePickerl ? (
            <>
              <Button
                variant="outline"
                size="sm"
                data-action-id={ENTITY_ACTION_IDS.vehiclePickerlContact}
                onClick={() => onRecordContact(row.original)}
              >
                {t('pickerlDue.recordContact')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRecordPickerl(row.original.id)}
              >
                {t('pickerlDue.recordPickerl')}
              </Button>
              {row.original.openPickerlOrder ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenOrder(row.original.openPickerlOrder!.id)}
                >
                  {t('pickerlDue.openOrder')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onCreateOrder(row.original.id)}
                >
                  {t('pickerlDue.createOrder')}
                </Button>
              )}
            </>
          ) : null}
        </div>
      ),
    },
  ]
}

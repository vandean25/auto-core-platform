import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Phone, Clock, Key, MapPin, User } from 'lucide-react'
import { useAuthSession } from '@/api/auth-session'
import { useGenerateWorkshopPdf } from '@/api/workshop'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { formatDateShort, formatOdometerKm } from '@/lib/format'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatusBadge } from '@/components/status/StatusBadge'
import { CatalogSourceBanner } from '@/components/workshop/CatalogSourceBanner'
import type { CatalogProviderOemConcern, WorkshopOrder } from '@/api/types'
import { isWorkshopTechAssignableStatus } from '@/features/actions/action-role-predicates'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'
import { createWorkshopOrderJobCardPdfAction } from '@/features/actions/work-order-row-actions'
import { workshopOrderToListRow } from '@/features/peek/WorkshopOrderPeekContent'
import type { CatalogSearchSession } from '@/features/workshop/catalog-source-copy'

type WorkshopMechanicOption = {
  id: string
  name: string
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d+]/g, '')
}

function getCustomerName(order: WorkshopOrder, dealerStockLabel: string) {
  if (!order.customer) return dealerStockLabel
  if (order.customer.type === 'COMPANY' && order.customer.company_name) {
    return order.customer.company_name
  }
  return `${order.customer.first_name} ${order.customer.last_name}`.trim()
}

function getVehicleLabel(order: WorkshopOrder) {
  return `${order.vehicle.year} ${order.vehicle.make} ${order.vehicle.model}`
}

function OrderTopBarLoanerBadge({ order }: { order: WorkshopOrder }) {
  const { t } = useTranslation('workshop')
  const loaner = order.loanerBooking
  if (!loaner) return null

  return (
    <Link
      to={`${APP_ROUTE_PATHS.workshopLoanerVehicles}?vehicle=${loaner.loanerVehicleId}`}
      className='inline-flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100'
    >
      <span>
        {t('orderHeader.loanerUntil', {
          label: loaner.vehiclePlate ?? loaner.displayName,
          date: formatDateShort(loaner.plannedTo),
        })}
      </span>
      <StatusBadge status={loaner.status} />
    </Link>
  )
}

function OrderTopBarCatalogBanners({
  catalogSearchSession,
  oemConcernCode,
}: {
  catalogSearchSession?: CatalogSearchSession
  oemConcernCode?: CatalogProviderOemConcern['code'] | null
}) {
  const parts = catalogSearchSession?.parts
  const labor = catalogSearchSession?.labor
  if (!parts && !labor) return null

  return (
    <div className='flex flex-wrap gap-2 pt-1'>
      {parts ? (
        <CatalogSourceBanner
          metadata={parts}
          oemConcernCode={oemConcernCode}
          compact
        />
      ) : null}
      {labor ? (
        <CatalogSourceBanner
          metadata={labor}
          oemConcernCode={oemConcernCode}
          compact
        />
      ) : null}
    </div>
  )
}

function OrderJobCardPdfButton({ order }: { order: WorkshopOrder }) {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const generatePdf = useGenerateWorkshopPdf()
  const role = useAuthSession()?.data?.activeRole
  const jobCardPdfAction = useMemo(() => createWorkshopOrderJobCardPdfAction(t), [t])
  const listRow = useMemo(() => workshopOrderToListRow(order), [order])
  const runContext = useMemo(() => ({ navigate, generatePdf, t }), [generatePdf, navigate, t])

  return (
    <RegistryActionButton
      action={jobCardPdfAction}
      record={listRow}
      runContext={runContext}
      role={role}
      label={t('orderHeader.printJobCard')}
      className="min-h-11"
    />
  )
}

export interface OrderTopBarProps {
  order: WorkshopOrder
  assignedTechName?: string | null
  bayName?: string | null
  catalogSearchSession?: CatalogSearchSession
  oemConcernCode?: CatalogProviderOemConcern['code'] | null
  checkInHref?: string | null
}

export function OrderTopBar({
  order,
  assignedTechName,
  bayName,
  catalogSearchSession,
  oemConcernCode,
  checkInHref,
}: OrderTopBarProps) {
  const { t } = useTranslation('workshop')
  const customerName = getCustomerName(order, t('orderHeader.dealerStock'))
  const vehicleLabel = getVehicleLabel(order)
  const plate = order.vehicle.plate || t('orderHeader.noPlate')
  const unassigned = t('orderHeader.unassigned')
  const notSet = t('orderHeader.notSet')

  return (
    <header>
      <Card className='mb-8'>
        <CardContent className='p-4 sm:p-5'>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between'>
            <div className='space-y-3'>
              <div className='flex items-center gap-3'>
                <h1 className='text-2xl font-semibold tracking-tight'>{order.order_number ?? `#${order.id}`}</h1>
                <StatusBadge status={order.status} />
              </div>
              <p className='text-sm text-slate-500'>
                {customerName} · {vehicleLabel} · {plate}
              </p>
              <p className='text-sm text-slate-500'>
                {t('orderHeader.promisedMeta', {
                  promised: notSet,
                  tech: assignedTechName ?? unassigned,
                  bay: bayName ?? unassigned,
                })}
              </p>
              <OrderTopBarLoanerBadge order={order} />
              <OrderTopBarCatalogBanners
                catalogSearchSession={catalogSearchSession}
                oemConcernCode={oemConcernCode}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {checkInHref ? (
                <Button variant="default" className="min-h-11" asChild>
                  <Link to={checkInHref} data-testid="workshop-order-check-in-link">
                    {t('orderHeader.startCheckIn')}
                  </Link>
                </Button>
              ) : null}
              <OrderJobCardPdfButton order={order} />
            </div>
          </div>
        </CardContent>
      </Card>
    </header>
  )
}

function AssignedTechField({
  assignedTechName,
  assignedTechId,
  mechanics,
  disabled,
  unassignedLabel,
  ariaLabel,
  onAssignedTechChange,
}: {
  assignedTechName?: string | null
  assignedTechId?: string | null
  mechanics: WorkshopMechanicOption[]
  disabled: boolean
  unassignedLabel: string
  ariaLabel: string
  onAssignedTechChange?: (mechanicId: string | null) => void
}) {
  if (!onAssignedTechChange) {
    return (
      <div className='font-medium flex items-center'>
        <User className='w-4 h-4 mr-1.5 text-slate-500' />
        {assignedTechName ?? unassignedLabel}
      </div>
    )
  }

  return (
    <Select
      value={assignedTechId ?? 'unassigned'}
      onValueChange={(value) => onAssignedTechChange(value === 'unassigned' ? null : value)}
      disabled={disabled}
    >
      <SelectTrigger
        className='h-9 font-medium'
        data-testid='assigned-tech-select'
        aria-label={ariaLabel}
      >
        <div className='flex items-center'>
          <User className='w-4 h-4 mr-1.5 text-slate-500' />
          <SelectValue placeholder={unassignedLabel} />
        </div>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value='unassigned'>{unassignedLabel}</SelectItem>
        {mechanics.map((mechanic) => (
          <SelectItem key={mechanic.id} value={mechanic.id}>
            {mechanic.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function CustomerVehicleInfo({
  order,
  assignedTechName,
  assignedTechId,
  mechanics = [],
  bayName,
  canAssignTech = false,
  isAssigningTech = false,
  onAssignedTechChange,
}: {
  order: WorkshopOrder
  assignedTechName?: string | null
  assignedTechId?: string | null
  mechanics?: WorkshopMechanicOption[]
  bayName?: string | null
  canAssignTech?: boolean
  isAssigningTech?: boolean
  onAssignedTechChange?: (mechanicId: string | null) => void
}) {
  const { t } = useTranslation('workshop')
  const canAssign = canAssignTech && isWorkshopTechAssignableStatus(order.status)
  const customerName = getCustomerName(order, t('orderHeader.dealerStock'))
  const customerPhone = order.customer?.phone ?? ''
  const unassigned = t('orderHeader.unassigned')
  const notSet = t('orderHeader.notSet')
  const na = t('orderHeader.noPlate')

  return (
    <>
      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base font-semibold'>{t('orderHeader.orderInfo')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4 text-sm'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <div>
              <div className='text-muted-foreground mb-1'>{t('orderHeader.assignedTech')}</div>
              <AssignedTechField
                assignedTechName={assignedTechName}
                assignedTechId={assignedTechId}
                mechanics={mechanics}
                disabled={!canAssign || isAssigningTech}
                unassignedLabel={unassigned}
                ariaLabel={t('orderHeader.assignedTech')}
                onAssignedTechChange={onAssignedTechChange}
              />
            </div>
            <div>
              <div className='text-muted-foreground mb-1'>{t('orderHeader.bayLocation')}</div>
              <div className='font-medium flex items-center'>
                <MapPin className='w-4 h-4 mr-1.5 text-slate-500' />
                {bayName ?? unassigned}
              </div>
            </div>
            <div>
              <div className='text-muted-foreground mb-1'>{t('orderHeader.promisedTime')}</div>
              <div className='font-medium flex items-center'>
                <Clock className='w-4 h-4 mr-1.5 text-slate-500' />
                {notSet}
              </div>
            </div>
            <div>
              <div className='text-muted-foreground mb-1'>{t('orderHeader.keyTag')}</div>
              <div className='font-medium flex items-center'>
                <Key className='w-4 h-4 mr-1.5 text-slate-500' />
                {notSet}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base font-semibold'>{t('orderHeader.customerInfo')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3 text-sm'>
          <div>
            <div className='font-medium'>{customerName}</div>
            <div className='text-muted-foreground'>{order.customer?.email}</div>
          </div>
          <div>
            <div className='text-muted-foreground'>{t('orderHeader.phone')}</div>
            <div className='font-medium'>{customerPhone || na}</div>
          </div>
          {customerPhone && (
            <Button variant='outline' size='sm' className='h-8' asChild>
              <a href={`tel:${normalizePhone(customerPhone)}`}>
                <Phone className='h-3.5 w-3.5 mr-1.5' />
                {t('orderHeader.callCustomer')}
              </a>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base font-semibold'>{t('orderHeader.vehicleInfo')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3 text-sm'>
          <div className='font-medium'>{getVehicleLabel(order)}</div>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
            <div>
              <div className='text-muted-foreground'>{t('orderHeader.vin')}</div>
              <div className='font-medium'>{order.vehicle.vin || na}</div>
            </div>
            <div>
              <div className='text-muted-foreground'>{t('orderHeader.plate')}</div>
              <div className='font-medium'>{order.vehicle.plate || na}</div>
            </div>
            <div>
              <div className='text-muted-foreground'>{t('orderHeader.mileage')}</div>
              <div className='font-medium'>
                {typeof order.odometer === 'number' ? formatOdometerKm(order.odometer) : '-'}
              </div>
            </div>
            <div>
              <div className='text-muted-foreground'>{t('orderHeader.fuel')}</div>
              <div className='font-medium'>
                {typeof order.fuel_level === 'number' ? `${order.fuel_level}%` : '-'}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

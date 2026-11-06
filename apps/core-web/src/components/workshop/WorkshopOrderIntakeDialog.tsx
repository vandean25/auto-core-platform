import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Customer, Vehicle, WorkshopSearchResponse } from '@/api/types'
import { useCreateWorkshopOrder, useRegisterIntake, useWorkshopSearch } from '@/api/workshop'
import { useVehicle } from '@/api/vehicles'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  canSubmitOrder,
  emptyCustomerForm,
  emptyVehicleForm,
  visibleConflict,
} from '@/features/workshop/intake-form'
import type {
  ExistingOrderConflict,
  IntakeCustomerMode,
  IntakeTab,
  NewCustomerForm,
  NewVehicleForm,
} from '@/features/workshop/intake-form'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import { PageLoader } from '@/components/ui/PageLoader'
import { SubmitButtonPending } from '@/components/data-table/data-table-states'
import { RegistrationDocumentIntakeStep } from './RegistrationDocumentIntakeStep'
import { IntakeExistingVehiclePanel, IntakeNewVehiclePanel, IntakeOrderFields } from './workshop-order-intake-panels'
import {
  submitWorkshopIntakeOrder,
  type PendingOrderFailure,
  type WorkshopOrderListPendingRow,
} from './workshop-order-intake-create'

type ExistingVehicle = Vehicle & { customer: Customer | null }
type ExistingCustomer = Customer & { vehicles: Vehicle[] }

interface WorkshopOrderIntakeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialVehicleId?: string
  pickerlMode?: boolean
  listPendingMode?: boolean
  onPendingOrder?: (row: WorkshopOrderListPendingRow, meta: { localId: string }) => void
  onPendingOrderSettled?: (localId: string, serverOrderId: string) => void
  onPendingOrderFailed?: (localId: string, failure: PendingOrderFailure) => void
}

export function WorkshopOrderIntakeDialog({
  open,
  onOpenChange,
  initialVehicleId,
  pickerlMode = false,
  listPendingMode = false,
  onPendingOrder,
  onPendingOrderSettled,
  onPendingOrderFailed,
}: WorkshopOrderIntakeDialogProps) {
  const { t } = useTranslation('workshop')
  const [workshopNamespaceReady, setWorkshopNamespaceReady] = useState(() =>
    i18n.hasResourceBundle(i18n.language, 'workshop'),
  )
  const navigate = useNavigate()
  const createOrder = useCreateWorkshopOrder()
  const registerIntake = useRegisterIntake()

  const [activeTab, setActiveTab] = useState<IntakeTab>('existing')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState<ExistingVehicle | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<ExistingCustomer | null>(null)
  const [customerMode, setCustomerMode] = useState<IntakeCustomerMode>('existing')
  const [newVehicle, setNewVehicle] = useState<NewVehicleForm>(emptyVehicleForm)
  const [newCustomer, setNewCustomer] = useState<NewCustomerForm>(emptyCustomerForm)
  const [odometer, setOdometer] = useState('')
  const [fuelLevel, setFuelLevel] = useState('50')
  const [notes, setNotes] = useState('')
  const [existingOrderConflict, setExistingOrderConflict] = useState<ExistingOrderConflict | null>(
    null,
  )
  // Counts attempts and resets, so a request that finishes after the dialog was reset cannot store its conflict.
  const attemptRef = useRef(0)
  const initialVehicleQuery = useVehicle<ExistingVehicle>(initialVehicleId ?? '')

  useEffect(() => {
    if (!open || workshopNamespaceReady) return
    void ensureNamespaceLoaded('workshop').then(() => setWorkshopNamespaceReady(true))
  }, [open, workshopNamespaceReady])

  useEffect(() => {
    if (!open || !initialVehicleQuery.data) return
    setActiveTab('existing')
    setSelectedVehicle(initialVehicleQuery.data)
    setSearch(initialVehicleQuery.data.plate ?? '')
    setNotes(pickerlMode ? t('orderIntake.pickerlNotesDefault') : '')
  }, [open, initialVehicleQuery.data, pickerlMode, t])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  const resetDialogState = () => {
    attemptRef.current += 1
    setSearch('')
    setDebouncedSearch('')
    setSelectedVehicle(null)
    setSelectedCustomer(null)
    setCustomerMode('existing')
    setActiveTab('existing')
    setNewVehicle(emptyVehicleForm())
    setNewCustomer(emptyCustomerForm())
    setOdometer('')
    setFuelLevel('50')
    setNotes('')
    setExistingOrderConflict(null)
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetDialogState()
    }
    onOpenChange(nextOpen)
  }

  const { data: searchData, isLoading } = useWorkshopSearch(debouncedSearch)
  const vehicles = (searchData as WorkshopSearchResponse | undefined)?.data?.vehicles ?? []
  const customers = (searchData as WorkshopSearchResponse | undefined)?.data?.customers ?? []

  function openCreatedOrder(orderId: string, message: string) {
    toast.success(message)
    handleDialogOpenChange(false)
    navigate(`/workshop/orders/${orderId}`)
  }

  function handleOpenExistingOrder(orderId: string) {
    handleDialogOpenChange(false)
    navigate(`/workshop/orders/${orderId}`)
  }

  const pendingCallbacks = {
    listPendingMode,
    onPendingOrder,
    onPendingOrderSettled,
    closeDialog: () => handleDialogOpenChange(false),
  }

  const orderPayload = {
    odometer: Number(odometer),
    fuelLevel: Number(fuelLevel),
    reportedIssue: notes || undefined,
  }

  const formSignature = JSON.stringify([newVehicle, newCustomer, customerMode, selectedCustomer?.id ?? null])

  async function handleCreateOrder() {
    setExistingOrderConflict(null)
    attemptRef.current += 1
    const attempt = attemptRef.current
    await submitWorkshopIntakeOrder({
      activeTab,
      selectedVehicle,
      selectedCustomer,
      customerMode,
      newVehicle,
      newCustomer,
      orderPayload,
      pickerlMode,
      isCurrentAttempt: () => attempt === attemptRef.current,
      formSignature,
      messages: {
        selectVehicle: t('orderIntake.toastSelectVehicle'),
        selectCustomer: t('orderIntake.toastSelectCustomer'),
        noCustomerLinked: t('orderIntake.toastNoCustomerLinked'),
        pickerlOpened: t('orderIntake.toastPickerlOpened'),
        orderCreated: t('orderIntake.toastOrderCreated'),
        createFailed: t('orderIntake.toastCreateFailed'),
      },
      registerVehicle: (payload) => registerIntake.mutateAsync(payload) as Promise<ExistingVehicle>,
      createOrder: (payload) => createOrder.mutateAsync(payload),
      pendingCallbacks,
      notify: {
        toastSuccess: (message) => toast.success(message),
        onNavigateCreated: (orderId, message) => openCreatedOrder(orderId, message),
        toastError: (message) => toast.error(message),
        onConflict: setExistingOrderConflict,
        onPendingFailed: (localId, failure) => onPendingOrderFailed?.(localId, failure),
      },
    })
  }

  const activeConflict = visibleConflict(existingOrderConflict, {
    tab: activeTab,
    selectedVehicleId: selectedVehicle?.id,
    formSignature,
  })
  const canSubmit = canSubmitOrder({
    tab: activeTab,
    selectedVehicleCustomerId: selectedVehicle?.customer?.id,
    newVehicle,
    newCustomer,
    customerMode,
    selectedCustomerId: selectedCustomer?.id,
    odometer,
    fuelLevel,
  })

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent fullScreenOnPhone className="flex flex-col overflow-hidden sm:max-w-4xl">
        {open && !workshopNamespaceReady ? (
          <PageLoader />
        ) : (
          <>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('orderIntake.title')}</DialogTitle>
          <DialogDescription>
            {pickerlMode ? t('orderIntake.descriptionPickerl') : t('orderIntake.description')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as IntakeTab)}>
            {!pickerlMode ? (
              <TabsList className="grid h-auto w-full grid-cols-1 sm:inline-flex sm:h-9 sm:w-auto">
                <TabsTrigger value="existing">
                  {t('orderIntake.tabExisting')}
                </TabsTrigger>
                <TabsTrigger value="new-vehicle">
                  {t('orderIntake.tabNewVehicle')}
                </TabsTrigger>
                <TabsTrigger value="registration-document">
                  {t('orderIntake.tabRegistration')}
                </TabsTrigger>
              </TabsList>
            ) : null}

            <TabsContent value="existing" className="space-y-4">
              <IntakeExistingVehiclePanel
                t={t}
                search={search}
                onSearchChange={setSearch}
                isLoading={isLoading}
                vehicles={vehicles}
                selectedVehicle={selectedVehicle}
                onSelectVehicle={setSelectedVehicle}
              />
            </TabsContent>

            <TabsContent value="new-vehicle" className="space-y-4">
              <IntakeNewVehiclePanel
                t={t}
                newVehicle={newVehicle}
                onVehicleChange={setNewVehicle}
                customerMode={customerMode}
                onCustomerModeChange={setCustomerMode}
                search={search}
                onSearchChange={setSearch}
                customers={customers}
                selectedCustomer={selectedCustomer}
                onSelectCustomer={setSelectedCustomer}
                newCustomer={newCustomer}
                onCustomerChange={setNewCustomer}
              />
            </TabsContent>

            <TabsContent value="registration-document" className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('orderIntake.registrationHint')}</p>
              <RegistrationDocumentIntakeStep
                odometer={odometer}
                fuelLevel={fuelLevel}
                notes={notes}
                onOrderCreated={(orderId) => {
                  handleDialogOpenChange(false)
                  navigate(
                    APP_ROUTE_PATHS.workshopOrderCheckIn.replace(':id', orderId),
                  )
                }}
              />
            </TabsContent>
          </Tabs>

          <IntakeOrderFields
            t={t}
            odometer={odometer}
            fuelLevel={fuelLevel}
            notes={notes}
            onOdometerChange={setOdometer}
            onFuelLevelChange={setFuelLevel}
            onNotesChange={setNotes}
          />

          {activeConflict ? (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{activeConflict.message}</span>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => handleOpenExistingOrder(activeConflict.orderId)}
                >
                  {activeConflict.orderNumber
                    ? t('orderIntake.openOrderNumber', { orderNumber: activeConflict.orderNumber })
                    : t('orderIntake.openExistingOrder')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>

        <DialogFooter className="shrink-0 max-sm:gap-2">
          <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
            {t('orderIntake.cancel')}
          </Button>
          <SubmitButtonPending
            type="button"
            pending={createOrder.isPending || registerIntake.isPending}
            label={pickerlMode ? t('orderIntake.createPickerl') : t('orderIntake.createOrder')}
            disabled={!canSubmit || activeTab === 'registration-document'}
            onClick={handleCreateOrder}
          />
        </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

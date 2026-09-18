import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthSession } from '@/api/auth-session'
import { useAuth } from '@/auth/AuthProvider'
import { useInventory } from '@/api/inventory'
import { useLocations } from '@/api/locations'
import { useMySites } from '@/api/sites'
import {
  useApproveStockTransfer,
  useCancelStockTransfer,
  useReceiveStockTransfer,
  useRejectStockTransfer,
  useReturnStockTransfer,
  useShipStockTransfer,
  useStockTransfer,
} from '@/api/stock-transfers'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatusBadge } from '@/components/status/StatusBadge'
import { generateId } from '@/lib/id'
import { getErrorMessage } from '@/lib/error-utils'
import {
  buildMemberSiteIdSet,
  canApproveOrRejectTransfer,
  canCancelTransfer,
  canReceiveTransfer,
  canReturnTransfer,
  canShipTransfer,
  canSubmitShip,
  getLinesMissingShipSourceBins,
  hasReceiveMembership,
  hasShipMembership,
  resolveShipSourceLocationId,
  shouldShowSourceBinDetails,
} from './stock-transfer-permissions'

function formatQty(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed.toLocaleString() : value
}

export default function StockTransferDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const { user } = useAuth()
  const sessionQuery = useAuthSession(user?.uid ?? user?.email ?? null, Boolean(user))
  const { data: mySites = [] } = useMySites(Boolean(id))
  const { data: transfer, isLoading, error } = useStockTransfer(id)
  const { data: inventoryResponse } = useInventory({ pageSize: 200 })

  const approveMutation = useApproveStockTransfer(id)
  const rejectMutation = useRejectStockTransfer(id)
  const cancelMutation = useCancelStockTransfer(id)
  const shipMutation = useShipStockTransfer(id)
  const receiveMutation = useReceiveStockTransfer(id)
  const returnMutation = useReturnStockTransfer(id)

  const [cancelReason, setCancelReason] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [receiveQtyByLine, setReceiveQtyByLine] = useState<Record<string, string>>({})
  const [returnQtyByLine, setReturnQtyByLine] = useState<Record<string, string>>({})
  const [destLocationByLine, setDestLocationByLine] = useState<Record<string, string>>({})
  const [sourceLocationByLine, setSourceLocationByLine] = useState<Record<string, string>>({})

  const memberSiteIds = useMemo(
    () => buildMemberSiteIdSet(mySites.map((site) => site.id)),
    [mySites],
  )

  const activeSiteId = sessionQuery.data?.activeSiteId ?? null
  const currentUserId = sessionQuery.data?.userId ?? user?.uid ?? null
  const activeRole = sessionQuery.data?.activeRole ?? null

  const canShipOnActiveSite = Boolean(
    transfer && canShipTransfer(transfer, memberSiteIds, activeSiteId),
  )
  const canReceiveOnActiveSite = Boolean(
    transfer && canReceiveTransfer(transfer, memberSiteIds, activeSiteId),
  )
  const showShipControls = Boolean(
    transfer && hasShipMembership(transfer, memberSiteIds) && canShipOnActiveSite,
  )
  const showReceiveControls = Boolean(
    transfer && hasReceiveMembership(transfer, memberSiteIds) && canReceiveOnActiveSite,
  )

  const { data: locations = [] } = useLocations({
    enabled: Boolean(transfer && (showShipControls || showReceiveControls)),
  })

  const catalogLabelById = useMemo(() => {
    const map = new Map<string, { sku: string; name: string }>()
    for (const item of inventoryResponse?.data ?? []) {
      map.set(item.id, { sku: item.sku, name: item.name })
    }
    return map
  }, [inventoryResponse?.data])

  const locationLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const location of locations) {
      map.set(location.id, `${location.code} — ${location.name}`)
    }
    return map
  }, [locations])

  const destinationBins = locations.filter((location) => location.type === 'bin')
  const sourceBins = locations.filter((location) => location.type === 'bin')

  if (isLoading) {
    return <div className="p-8 text-center">Loading transfer…</div>
  }

  if (error || !transfer) {
    return <div className="p-8 text-center">Transfer not found</div>
  }

  const canApprove = canApproveOrRejectTransfer(transfer, memberSiteIds, activeRole)
  const canReject = canApprove
  const canCancel = canCancelTransfer(
    transfer,
    memberSiteIds,
    currentUserId,
    activeRole,
  )
  const canShip = canShipOnActiveSite
  const canReceive = canReceiveOnActiveSite
  const canReturn = canReturnTransfer(transfer, memberSiteIds, activeRole)
  const shipReady = canSubmitShip(transfer, sourceLocationByLine)
  const needsFromSiteForShip =
    hasShipMembership(transfer, memberSiteIds) && activeSiteId !== transfer.fromSiteId
  const needsToSiteForReceive =
    hasReceiveMembership(transfer, memberSiteIds) && activeSiteId !== transfer.toSiteId

  const runAction = async (
    label: string,
    action: () => Promise<unknown>,
  ) => {
    try {
      await action()
      toast.success(label)
    } catch (actionError: unknown) {
      toast.error(getErrorMessage(actionError, `Failed to ${label.toLowerCase()}`))
    }
  }

  const handleApprove = () =>
    runAction('Transfer approved', () =>
      approveMutation.mutateAsync({
        expectedVersion: transfer.version,
      }),
    )

  const handleReject = () =>
    runAction('Transfer rejected', () =>
      rejectMutation.mutateAsync({
        expectedVersion: transfer.version,
        reason: rejectReason || undefined,
      }),
    )

  const handleCancel = () =>
    runAction('Transfer cancelled', () =>
      cancelMutation.mutateAsync({
        expectedVersion: transfer.version,
        reason: cancelReason || undefined,
      }),
    )

  const handleShip = () => {
    if (!canShipOnActiveSite) {
      toast.error('Switch your active site to the source site before shipping')
      return
    }

    const missingSourceBins = getLinesMissingShipSourceBins(transfer, sourceLocationByLine)
    if (missingSourceBins.length > 0) {
      toast.error('Select a source bin for every approved line before shipping')
      return
    }

    const lines = transfer.lines
      .filter((line) => Number(line.approvedQty) > 0)
      .map((line) => ({
        id: line.id,
        sourceLocationId: resolveShipSourceLocationId(line, sourceLocationByLine)!,
      }))

    return runAction('Transfer shipped', () =>
      shipMutation.mutateAsync({
        expectedVersion: transfer.version,
        lines,
      }),
    )
  }

  const handleReceive = () => {
    if (!canReceiveOnActiveSite) {
      toast.error('Switch your active site to the destination site before receiving')
      return
    }

    const lines = transfer.lines
      .map((line) => {
        const receiveQty = Number(receiveQtyByLine[line.id] ?? '0')
        const destLocationId = destLocationByLine[line.id] ?? line.destLocationId ?? ''
        if (!receiveQty || !destLocationId) return null
        return {
          id: line.id,
          receiveQty,
          destLocationId,
        }
      })
      .filter((line): line is NonNullable<typeof line> => line !== null)

    if (lines.length === 0) {
      toast.error('Enter receive quantity and destination bin for at least one line')
      return
    }

    return runAction('Stock received', () =>
      receiveMutation.mutateAsync({
        expectedVersion: transfer.version,
        idempotencyKey: generateId(),
        lines,
      }),
    )
  }

  const handleReturn = () => {
    const lines = transfer.lines
      .map((line) => {
        const returnQty = Number(returnQtyByLine[line.id] ?? '0')
        if (!returnQty) return null
        return { id: line.id, returnQty }
      })
      .filter((line): line is NonNullable<typeof line> => line !== null)

    if (lines.length === 0) {
      toast.error('Enter return quantity for at least one line')
      return
    }

    return runAction('Unreceived stock returned', () =>
      returnMutation.mutateAsync({
        expectedVersion: transfer.version,
        idempotencyKey: generateId(),
        lines,
      }),
    )
  }

  return (
    <div className="space-y-6">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/stock-transfers">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
              {transfer.transferNumber}
              <StatusBadge status={transfer.status} />
            </h1>
            <p className="text-slate-500">
              Requested {format(new Date(transfer.createdAt), 'PPP p')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {canApprove ? (
            <Button onClick={() => void handleApprove()} disabled={approveMutation.isPending}>
              Approve
            </Button>
          ) : null}

          {canReject ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Reject</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reject transfer request?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The destination site will be notified that this request was rejected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="reject-reason">Reason (optional)</Label>
                  <Input
                    id="reject-reason"
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep request</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleReject()}>
                    Reject
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}

          {canCancel ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline">Cancel</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel transfer?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This stops the transfer before any stock has shipped.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="cancel-reason">Reason (optional)</Label>
                  <Input
                    id="cancel-reason"
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                  />
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep transfer</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleCancel()}>
                    Cancel transfer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}

          {canShip ? (
            <Button
              onClick={() => void handleShip()}
              disabled={shipMutation.isPending || !shipReady}
            >
              Ship
            </Button>
          ) : null}

          {canReceive ? (
            <Button onClick={() => void handleReceive()} disabled={receiveMutation.isPending}>
              Receive
            </Button>
          ) : null}

          {canReturn ? (
            <Button
              variant="outline"
              onClick={() => void handleReturn()}
              disabled={returnMutation.isPending}
            >
              Return unreceived
            </Button>
          ) : null}
        </div>
      </div>

      {needsFromSiteForShip ? (
        <p className="text-sm text-amber-700">
          Switch your active site to {transfer.fromSiteName ?? 'the source site'} to pick source
          bins and ship.
        </p>
      ) : null}
      {needsToSiteForReceive ? (
        <p className="text-sm text-amber-700">
          Switch your active site to {transfer.toSiteName ?? 'the destination site'} to receive
          stock.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Route</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-slate-500">From</p>
              <p className="font-medium">
                {transfer.fromSiteName ?? transfer.fromSiteId}
              </p>
            </div>
            <div>
              <p className="text-slate-500">To</p>
              <p className="font-medium">{transfer.toSiteName ?? transfer.toSiteId}</p>
            </div>
            {transfer.rejectReason ? (
              <div>
                <p className="text-slate-500">Reject reason</p>
                <p>{transfer.rejectReason}</p>
              </div>
            ) : null}
            {transfer.cancelReason ? (
              <div>
                <p className="text-slate-500">Cancel reason</p>
                <p>{transfer.cancelReason}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Lines</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead className="text-right">Shipped</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Returned</TableHead>
                  <TableHead>Source bin</TableHead>
                  <TableHead>Dest bin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transfer.lines.map((line) => {
                  const catalog = catalogLabelById.get(line.catalogItemId)
                  const showSourceBin = shouldShowSourceBinDetails(
                    transfer.fromSiteId,
                    memberSiteIds,
                    line.sourceLocationId,
                  )
                  const outstandingReceive =
                    Number(line.shippedQty) -
                    Number(line.receivedQty) -
                    Number(line.returnedQty)

                  return (
                    <TableRow key={line.id}>
                      <TableCell>
                        <div className="font-medium">
                          {catalog?.sku ?? line.catalogItemId}
                        </div>
                        {catalog?.name ? (
                          <div className="text-xs text-slate-500">{catalog.name}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(line.requestedQty)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(line.approvedQty)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(line.shippedQty)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(line.receivedQty)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(line.returnedQty)}
                      </TableCell>
                      <TableCell>
                        {showSourceBin
                          ? locationLabelById.get(line.sourceLocationId ?? '') ??
                            line.sourceLocationId ??
                            '—'
                          : '—'}
                        {showShipControls && Number(line.approvedQty) > 0 ? (
                          <Select
                            value={
                              sourceLocationByLine[line.id] ??
                              line.sourceLocationId ??
                              undefined
                            }
                            onValueChange={(value) =>
                              setSourceLocationByLine((current) => ({
                                ...current,
                                [line.id]: value,
                              }))
                            }
                          >
                            <SelectTrigger className="mt-2 h-8">
                              <SelectValue placeholder="Confirm source bin" />
                            </SelectTrigger>
                            <SelectContent>
                              {sourceBins.map((location) => (
                                <SelectItem key={location.id} value={location.id}>
                                  {location.code} — {location.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {line.destLocationId
                          ? locationLabelById.get(line.destLocationId) ?? line.destLocationId
                          : '—'}
                        {showReceiveControls && outstandingReceive > 0 ? (
                          <div className="mt-2 space-y-2">
                            <Input
                              type="number"
                              min="0.001"
                              step="0.001"
                              placeholder="Receive qty"
                              value={receiveQtyByLine[line.id] ?? ''}
                              onChange={(event) =>
                                setReceiveQtyByLine((current) => ({
                                  ...current,
                                  [line.id]: event.target.value,
                                }))
                              }
                            />
                            <Select
                              value={
                                destLocationByLine[line.id] ??
                                line.destLocationId ??
                                undefined
                              }
                              onValueChange={(value) =>
                                setDestLocationByLine((current) => ({
                                  ...current,
                                  [line.id]: value,
                                }))
                              }
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Destination bin" />
                              </SelectTrigger>
                              <SelectContent>
                                {destinationBins.map((location) => (
                                  <SelectItem key={location.id} value={location.id}>
                                    {location.code} — {location.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                        {canReturn && outstandingReceive > 0 ? (
                          <Input
                            className="mt-2"
                            type="number"
                            min="0.001"
                            step="0.001"
                            placeholder="Return qty"
                            value={returnQtyByLine[line.id] ?? ''}
                            onChange={(event) =>
                              setReturnQtyByLine((current) => ({
                                ...current,
                                [line.id]: event.target.value,
                              }))
                            }
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

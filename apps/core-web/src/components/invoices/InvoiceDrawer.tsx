import { useState } from 'react'
import { toast } from 'sonner'
import { useInvoice } from '@/api/sales'
import { useIssueInvoice, useUpdateInvoiceDiscount } from '@/api/invoices'
import type { DiscountType, InvoiceItem } from '@/api/types'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'

const VAT_RATE = 0.2

interface InvoiceDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string | null
  orderId?: string
}

interface DiscountState {
  type: DiscountType | null
  value: string
}

const DEFAULT_DISCOUNT_STATE: DiscountState = { type: null, value: '' }

function parseDiscountValue(value: string) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function calculateDiscountAmount(
  baseAmount: number,
  type: DiscountType | null,
  value: number | null,
) {
  if (!type || value === null) return 0
  if (type === 'PERCENTAGE') {
    return (baseAmount * value) / 100
  }
  return value
}

function getLineNet(item: InvoiceItem) {
  return Number(item.quantity) * Number(item.unit_price)
}

export function InvoiceDrawer({
  open,
  onOpenChange,
  invoiceId,
  orderId,
}: InvoiceDrawerProps) {
  const { data: invoice, isLoading, isError, error } = useInvoice(invoiceId ?? '')
  const updateDiscount = useUpdateInvoiceDiscount()
  const issueInvoice = useIssueInvoice()

  const [lineDiscountOverrides, setLineDiscountOverrides] = useState<
    Record<string, DiscountState>
  >({})
  const [globalDiscountOverride, setGlobalDiscountOverride] =
    useState<DiscountState | null>(null)

  const isDraft = invoice?.status === 'DRAFT'

  const resolvedGlobalDiscount: DiscountState = {
    type: globalDiscountOverride?.type ?? invoice?.global_discount_type ?? null,
    value:
      globalDiscountOverride?.value ??
      (invoice?.global_discount_value !== null &&
      invoice?.global_discount_value !== undefined
        ? String(invoice?.global_discount_value)
        : ''),
  }

  const getLineDiscountState = (item: InvoiceItem): DiscountState => {
    if (lineDiscountOverrides[item.id]) {
      return lineDiscountOverrides[item.id]
    }
    return {
      type: item.line_discount_type ?? null,
      value:
        item.line_discount_value !== null && item.line_discount_value !== undefined
          ? String(item.line_discount_value)
          : '',
    }
  }

  const lineSummaries = invoice
    ? invoice.items.map((item) => {
        const currentDiscount = getLineDiscountState(item)
        const lineNet = getLineNet(item)
        const discountValue = parseDiscountValue(currentDiscount.value)
        const discountAmount = calculateDiscountAmount(
          lineNet,
          currentDiscount.type,
          discountValue,
        )
        const lineTotal = Math.max(0, lineNet - discountAmount)
        return {
          item,
          discount: currentDiscount,
          lineNet,
          lineTotal,
        }
      })
    : []

  const subtotalNet = lineSummaries.reduce((sum, line) => sum + line.lineTotal, 0)
  const globalValue = parseDiscountValue(resolvedGlobalDiscount.value)
  const discountedNet = Math.max(
    0,
    subtotalNet -
      calculateDiscountAmount(subtotalNet, resolvedGlobalDiscount.type, globalValue),
  )
  const vatAmount = discountedNet * VAT_RATE
  const totalGross = discountedNet + vatAmount

  const handleLineDiscountTypeChange = async (item: InvoiceItem, value: string) => {
    const nextType = value === 'NONE' ? null : (value as DiscountType)
    const current = getLineDiscountState(item)
    setLineDiscountOverrides((prev) => ({
      ...prev,
      [item.id]: { ...current, type: nextType },
    }))
    if (!isDraft || !invoiceId) return
    await commitLineDiscount(item.id, nextType, current.value)
  }

  const handleLineDiscountValueChange = (item: InvoiceItem, value: string) => {
    const current = getLineDiscountState(item)
    setLineDiscountOverrides((prev) => ({
      ...prev,
      [item.id]: { ...current, value },
    }))
  }

  const commitLineDiscount = async (
    itemId: string,
    typeOverride?: DiscountType | null,
    valueOverride?: string,
  ) => {
    if (!invoiceId) return
    const current = lineDiscountOverrides[itemId] ?? DEFAULT_DISCOUNT_STATE
    const type = typeOverride ?? current.type
    const value = valueOverride ?? current.value
    try {
      await updateDiscount.mutateAsync({
        invoiceId,
        payload: {
          lineItems: [
            {
              id: itemId,
              discountType: type,
              discountValue: parseDiscountValue(value),
            },
          ],
        },
      })
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update line discount')
    }
  }

  const handleGlobalDiscountTypeChange = async (value: string) => {
    const nextType = value === 'NONE' ? null : (value as DiscountType)
    setGlobalDiscountOverride({
      type: nextType,
      value: resolvedGlobalDiscount.value,
    })
    if (!isDraft || !invoiceId) return
    await commitGlobalDiscount(nextType, resolvedGlobalDiscount.value)
  }

  const handleGlobalDiscountValueChange = (value: string) => {
    setGlobalDiscountOverride({
      type: resolvedGlobalDiscount.type,
      value,
    })
  }

  const commitGlobalDiscount = async (
    typeOverride?: DiscountType | null,
    valueOverride?: string,
  ) => {
    if (!invoiceId) return
    try {
      await updateDiscount.mutateAsync({
        invoiceId,
        payload: {
          globalDiscountType: typeOverride ?? resolvedGlobalDiscount.type,
          globalDiscountValue: parseDiscountValue(
            valueOverride ?? resolvedGlobalDiscount.value,
          ),
        },
      })
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update global discount')
    }
  }

  const handleIssueInvoice = async () => {
    if (!invoiceId) return
    try {
      await issueInvoice.mutateAsync(invoiceId)
      toast.success('Invoice issued and locked')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to issue invoice')
    }
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[720px] p-0">
        <div className="h-full flex flex-col">
          <SheetHeader className="px-6 py-5 border-b">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <SheetTitle className="text-lg font-semibold tracking-tight">
                  Order #{orderId ?? invoice?.workshop_order_id ?? '—'}
                </SheetTitle>
                <SheetDescription className="text-xs">
                  Review invoice items, apply discounts, and lock when ready.
                </SheetDescription>
              </div>
              {invoice && <StatusBadge status={invoice.status} />}
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-hidden px-6 py-4">
            {isLoading && (
              <div className="text-sm text-muted-foreground">Loading invoice...</div>
            )}
            {isError && (
              <div className="text-sm text-muted-foreground">
                {(error as any)?.message || 'Failed to load invoice'}
              </div>
            )}
            {!isLoading && !isError && invoice && (
              <div className="h-full flex flex-col gap-6">
                <div className="border rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right w-[80px]">Qty</TableHead>
                        <TableHead className="text-right w-[140px]">Unit Price</TableHead>
                        <TableHead className="text-right w-[220px]">
                          Discount
                        </TableHead>
                        <TableHead className="text-right w-[140px]">
                          Line Total
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lineSummaries.map(({ item, discount, lineTotal }) => (
                        <TableRow key={item.id}>
                          <TableCell>{item.description}</TableCell>
                          <TableCell className="text-right">
                            {Number(item.quantity)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(Number(item.unit_price))}
                          </TableCell>
                          <TableCell>
                            {isDraft ? (
                              <div className="flex items-center justify-end gap-2">
                                <Select
                                  value={discount.type ?? 'NONE'}
                                  onValueChange={(value) =>
                                    void handleLineDiscountTypeChange(item, value)
                                  }
                                >
                                  <SelectTrigger className="h-8 w-[120px] text-xs">
                                    <SelectValue placeholder="No discount" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="NONE">None</SelectItem>
                                    <SelectItem value="PERCENTAGE">%</SelectItem>
                                    <SelectItem value="FLAT_AMOUNT">€</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Input
                                  value={discount.value}
                                  onChange={(e) =>
                                    handleLineDiscountValueChange(item, e.target.value)
                                  }
                                  onBlur={() =>
                                    void commitLineDiscount(
                                      item.id,
                                      discount.type,
                                      discount.value,
                                    )
                                  }
                                  placeholder="0"
                                  className="h-8 w-[80px] text-xs text-right"
                                  disabled={updateDiscount.isPending}
                                />
                              </div>
                            ) : (
                              <div className="text-right text-sm text-muted-foreground">
                                {discount.type && discount.value
                                  ? `${discount.value}${
                                      discount.type === 'PERCENTAGE' ? '%' : '€'
                                    }`
                                  : '—'}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(lineTotal)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="ml-auto w-full max-w-sm space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal Net</span>
                    <span>{formatCurrency(subtotalNet)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Global Discount</span>
                    {isDraft ? (
                      <div className="flex items-center gap-2">
                        <Select
                          value={resolvedGlobalDiscount.type ?? 'NONE'}
                          onValueChange={(value) =>
                            void handleGlobalDiscountTypeChange(value)
                          }
                        >
                          <SelectTrigger className="h-8 w-[120px] text-xs">
                            <SelectValue placeholder="None" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">None</SelectItem>
                            <SelectItem value="PERCENTAGE">%</SelectItem>
                            <SelectItem value="FLAT_AMOUNT">€</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={resolvedGlobalDiscount.value}
                          onChange={(e) => handleGlobalDiscountValueChange(e.target.value)}
                          onBlur={() =>
                            void commitGlobalDiscount(
                              resolvedGlobalDiscount.type,
                              resolvedGlobalDiscount.value,
                            )
                          }
                          placeholder="0"
                          className="h-8 w-[80px] text-xs text-right"
                          disabled={updateDiscount.isPending}
                        />
                      </div>
                    ) : (
                      <span>
                        {resolvedGlobalDiscount.type && resolvedGlobalDiscount.value
                          ? `${resolvedGlobalDiscount.value}${
                              resolvedGlobalDiscount.type === 'PERCENTAGE'
                                ? '%'
                                : '€'
                            }`
                          : '—'}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">20% MWSt (VAT)</span>
                    <span>{formatCurrency(vatAmount)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2 font-semibold">
                    <span>Total Gross</span>
                    <span>{formatCurrency(totalGross)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
            {invoice?.status === 'DRAFT' ? (
              <Button onClick={() => void handleIssueInvoice()} disabled={issueInvoice.isPending}>
                {issueInvoice.isPending ? 'Issuing...' : 'Lock & Issue Invoice'}
              </Button>
            ) : (
              <Button variant="outline" onClick={handlePrint}>
                Print Invoice
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

import * as React from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { format } from "date-fns"
import { Search, Trash2, Plus, Loader2, ArrowLeft } from "lucide-react"
import { toast } from "sonner"

import { useInvoiceEditor } from "@/hooks/useInvoiceEditor"
import { useFinalizeInvoice, useInvoice, useUpdateInvoice } from "@/api/sales"
import { useInventory } from "@/api/inventory"
import { CustomerSearch } from "@/components/sales/CustomerSearch"
import { DocumentSaveIndicator } from "@/components/document-save/DocumentSaveIndicator"
import { useDebouncedAutoSave } from "@/hooks/useDebouncedAutoSave"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import type { InventoryItem } from "@/api/types"
import { StatusBadge } from "@/components/status/StatusBadge"
import { getErrorMessage } from "@/lib/error-utils"

const DEFAULT_TAX_RATE = 20

export default function InvoiceDraftEditPage() {
  const { id: invoiceId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: invoice, isLoading, error } = useInvoice(invoiceId ?? "")
  const editor = useInvoiceEditor()
  const updateInvoiceMutation = useUpdateInvoice()
  const finalizeInvoiceMutation = useFinalizeInvoice()
  const lastSavedRef = React.useRef<string | null>(null)
  const hydratedRef = React.useRef(false)
  const draftNotesRef = React.useRef<string | undefined>(undefined)
  const updateMutationRef = React.useRef(updateInvoiceMutation)

  React.useEffect(() => {
    hydratedRef.current = false
    lastSavedRef.current = null
    draftNotesRef.current = undefined
  }, [invoiceId])

  React.useEffect(() => {
    updateMutationRef.current = updateInvoiceMutation
  })

  React.useEffect(() => {
    if (!invoice || hydratedRef.current) return
    const items = invoice.items.map((item) => ({
      tempId: item.id,
      id: item.id,
      catalog_item_id: item.catalog_item_id ?? undefined,
      description: item.description,
      quantity: Number(item.quantity),
      unit_price: Number(item.unit_price),
      tax_rate: Number(item.tax_rate),
    }))
    draftNotesRef.current = invoice.notes ?? undefined
    editor.hydrateFromSnapshot({
      customer: invoice.customer,
      date: new Date(invoice.date),
      dueDate: new Date(invoice.due_date),
      items,
    })
    lastSavedRef.current = invoice.customer
      ? JSON.stringify({
          customerId: invoice.customer.id,
          items: items.map((item) => ({
            catalogItemId: item.catalog_item_id,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            taxRate: item.tax_rate,
          })),
          notes: draftNotesRef.current,
        })
      : null
    hydratedRef.current = true
  }, [invoice, editor.hydrateFromSnapshot])

  const [partSearchOpen, setPartSearchOpen] = React.useState(false)
  const [activeRowIndex, setActiveRowIndex] = React.useState<number | null>(null)
  const [inventorySearch, setInventorySearch] = React.useState("")

  const { data: inventory } = useInventory({ search: inventorySearch, pageSize: 10 })

  const buildPayload = React.useCallback(() => {
    if (!editor.customer) return null
    return {
      customerId: editor.customer.id,
      items: editor.items.map((item) => ({
        catalogItemId: item.catalog_item_id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        taxRate: item.tax_rate,
      })),
      notes: draftNotesRef.current,
    }
  }, [editor.customer, editor.items])

  const saveDraft = React.useCallback(
    async (
      payload: NonNullable<ReturnType<typeof buildPayload>>,
      signal: AbortSignal,
    ) => {
      if (!invoiceId) return
      const serialized = JSON.stringify(payload)
      if (serialized === lastSavedRef.current) return

      await updateMutationRef.current.mutateAsync({
        id: invoiceId,
        payload,
        signal,
      })
      lastSavedRef.current = serialized
    },
    [invoiceId],
  )

  const { saveStatus, triggerAutoSave, clearPendingSave } = useDebouncedAutoSave({
    save: saveDraft,
    enabled: Boolean(invoiceId && invoice?.status === "DRAFT" && invoice.sales_order_id),
    shouldSave: (payload) =>
      Boolean(
        payload.customerId &&
          payload.items.length > 0 &&
          payload.items.every((item) => item.description.trim() !== ""),
      ),
  })

  React.useEffect(() => {
    const payload = buildPayload()
    if (!payload || !hydratedRef.current) return
    triggerAutoSave(payload)
  }, [buildPayload, triggerAutoSave])

  const handleFinalize = async () => {
    if (!editor.customer || !invoiceId) return
    if (!confirm("Are you sure? This will lock the invoice and deduct stock.")) return

    clearPendingSave()
    const payload = buildPayload()
    if (!payload) return

    try {
      await updateInvoiceMutation.mutateAsync({
        id: invoiceId,
        payload,
      })
      await finalizeInvoiceMutation.mutateAsync(invoiceId)
      toast.success("Invoice finalized and number generated!")
      navigate(`/sales/invoices/${invoiceId}`)
    } catch (finalizeError) {
      toast.error(getErrorMessage(finalizeError, "Failed to finalize invoice"))
    }
  }

  const openPartSearch = (index: number) => {
    setActiveRowIndex(index)
    setPartSearchOpen(true)
  }

  const handleSelectPart = (item: InventoryItem) => {
    if (activeRowIndex !== null) {
      editor.updateItem(activeRowIndex, {
        catalog_item_id: item.id,
        description: item.name,
        unit_price: item.price,
        tax_rate: DEFAULT_TAX_RATE
      })
    }
    setPartSearchOpen(false)
    setActiveRowIndex(null)
  }

  if (!invoiceId) {
    return <div className="p-8 text-center">Invoice not found</div>
  }

  if (isLoading) {
    return <div className="p-8 text-center">Loading invoice draft...</div>
  }

  if (error || !invoice) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        {getErrorMessage(error, "Failed to load invoice")}
      </div>
    )
  }

  if (!invoice.sales_order_id) {
    return (
      <div className="max-w-xl mx-auto space-y-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Unsupported draft</h1>
        <p className="text-slate-500">
          This invoice was not created from a sales order. Edit workshop or vehicle-sale invoices from
          their source workflows instead.
        </p>
        <Button asChild variant="outline">
          <Link to={`/sales/invoices/${invoice.id}`}>View invoice</Link>
        </Button>
      </div>
    )
  }

  if (invoice.status !== "DRAFT") {
    return (
      <div className="max-w-xl mx-auto space-y-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Invoice is not editable</h1>
        <p className="text-slate-500">Only draft invoices can be edited here.</p>
        <Button asChild variant="outline">
          <Link to={`/sales/invoices/${invoice.id}`}>View invoice</Link>
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to={`/sales-orders/${invoice.sales_order_id}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Edit Invoice Draft</h1>
          <StatusBadge status="DRAFT" />
        </div>
        <div className="flex gap-4 items-center">
          <DocumentSaveIndicator status={saveStatus} />
          <Button
            variant="destructive"
            onClick={handleFinalize}
            disabled={!editor.isValid || finalizeInvoiceMutation.isPending}
          >
            {finalizeInvoiceMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Finalize & Print
          </Button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto bg-white shadow-sm border rounded-lg p-8">
        <div className="grid grid-cols-2 gap-12 mb-12">
          <div className="space-y-4">
            <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
              Bill To
            </Label>
            <CustomerSearch value={editor.customer} onChange={editor.setCustomer} />

            {editor.customer && (
              <div className="text-sm text-gray-600 mt-2 pl-1 border-l-2 border-gray-100">
                <p>{editor.customer.address_street || "No street provided"}</p>
                <p>{editor.customer.address_zip} {editor.customer.address_city}</p>
                <p>{editor.customer.address_country}</p>
                <p className="mt-1">Email: {editor.customer.email}</p>
              </div>
            )}
          </div>

          <div className="space-y-4 text-right">
            <div className="flex flex-col items-end gap-2">
              <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
                Invoice Date
              </Label>
              <Input
                type="date"
                className="w-40 text-right"
                value={format(editor.date, 'yyyy-MM-dd')}
                onChange={(e) => editor.setDate(new Date(e.target.value))}
              />
            </div>
            <div className="flex flex-col items-end gap-2">
              <Label className="text-muted-foreground uppercase text-xs font-bold tracking-wider">
                Due Date
              </Label>
              <Input
                type="date"
                className="w-40 text-right"
                value={format(editor.dueDate, 'yyyy-MM-dd')}
                onChange={(e) => editor.setDueDate(new Date(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div className="mb-12">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]"></TableHead>
                <TableHead className="w-[40%]">Item / Description</TableHead>
                <TableHead className="w-[100px]">Qty</TableHead>
                <TableHead className="w-[120px]">Price (€)</TableHead>
                <TableHead className="w-[100px]">Tax (%)</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {editor.items.map((item, index) => (
                <TableRow key={item.tempId}>
                  <TableCell className="text-center text-muted-foreground">
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <div className="relative">
                      <Input
                        value={item.description}
                        onChange={(e) => editor.updateItem(index, { description: e.target.value })}
                        placeholder="Service or Item Name"
                        className="pr-10"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full text-muted-foreground hover:text-foreground"
                        onClick={() => openPartSearch(index)}
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      value={item.quantity}
                      onChange={(e) => editor.updateItem(index, { quantity: parseFloat(e.target.value) || 0 })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => editor.updateItem(index, { unit_price: parseFloat(e.target.value) || 0 })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={item.tax_rate}
                      onChange={(e) => editor.updateItem(index, { tax_rate: parseFloat(e.target.value) || 0 })}
                    />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    €{((item.quantity * item.unit_price) * (1 + item.tax_rate / 100)).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => editor.removeItem(index)}>
                      <Trash2 className="h-4 w-4 text-destructive opacity-50 hover:opacity-100" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <Button variant="outline" className="mt-4" onClick={editor.addItem}>
            <Plus className="mr-2 h-4 w-4" /> Add Line Item
          </Button>
        </div>

        <div className="flex justify-end border-t pt-8">
          <div className="w-64 space-y-3">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span>€{editor.totals.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Tax (VAT)</span>
              <span>€{editor.totals.taxTotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xl font-bold pt-3 border-t">
              <span>Total</span>
              <span>€{editor.totals.total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      <CommandDialog
        open={partSearchOpen}
        onOpenChange={setPartSearchOpen}
        title="Search Inventory"
        description="Find parts and add them to the invoice."
      >
        <CommandInput
          aria-label="Search inventory"
          placeholder="Search inventory…"
          value={inventorySearch}
          onValueChange={setInventorySearch}
        />
        <CommandList>
          <CommandEmpty>No parts found.</CommandEmpty>
          <CommandGroup heading="Inventory">
            {inventory?.data.map((part: InventoryItem) => (
              <CommandItem key={part.id} value={part.name + ' ' + part.sku} onSelect={() => handleSelectPart(part)}>
                <div className="flex flex-col">
                  <span className="font-medium">{part.name}</span>
                  <span className="text-xs text-muted-foreground">{part.sku} • Stock: {part.quantity_available} • €{part.price}</span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  )
}

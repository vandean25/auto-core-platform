import { useState, useEffect } from 'react'
import type { UseFieldArrayReturn, UseFormReturn } from 'react-hook-form'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useForm, useFieldArray } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { CustomerSearch } from '@/components/sales/CustomerSearch'
import { DocumentSaveIndicator } from '@/components/document-save/DocumentSaveIndicator'
import { useCustomer } from '@/api/customers'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import type { Customer, InventoryItem } from '@/api/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { calculateOrderTotal, type SalesOrderForm } from './sales-order-form'
import { SalesOrderItemSearch } from './SalesOrderItemSearch'
import { useSalesOrderDraft } from './useSalesOrderDraft'

type Lines = UseFieldArrayReturn<SalesOrderForm, 'items'>

function LineRow({
  form,
  index,
  remove,
}: {
  form: UseFormReturn<SalesOrderForm>
  index: number
  remove: (index: number) => void
}) {
  const { t } = useTranslation('sales')
  const description = String(form.watch(`items.${index}.description`) ?? '').trim()
  const label = description
    ? t('orders.create.lineNamed', { description, index: index + 1 })
    : t('orders.create.lineLabel', { index: index + 1 })

  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{index + 1}</TableCell>
      <TableCell>
        <FormField control={form.control} name={`items.${index}.description`} render={({ field }) => <Input {...field} />} />
      </TableCell>
      <TableCell>
        <FormField
          control={form.control}
          name={`items.${index}.quantity`}
          render={({ field }) => <Input type="number" min="1" {...field} />}
        />
      </TableCell>
      <TableCell>
        <FormField
          control={form.control}
          name={`items.${index}.unit_price`}
          render={({ field }) => <Input type="number" step="0.01" {...field} />}
        />
      </TableCell>
      <TableCell className="font-medium">
        {formatCurrency(
          Number(form.watch(`items.${index}.quantity`)) * Number(form.watch(`items.${index}.unit_price`)),
        )}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive"
          aria-label={t('orders.create.removeLineAria', { label })}
          onClick={() => remove(index)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  )
}

/** Line items of the new sales order: part search, editable rows and the running total. */
export function SalesOrderLinesCard({ form, lines }: { form: UseFormReturn<SalesOrderForm>; lines: Lines }) {
  const { t } = useTranslation('sales')
  const { fields, append, remove } = lines
  const currentTotal = calculateOrderTotal(form.watch('items'))

  const addItem = (item: InventoryItem) =>
    append({
      catalog_item_id: item.id,
      description: `${item.sku} - ${item.name}`,
      quantity: 1,
      unit_price: Number(item.price),
      tax_rate: 20,
    })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{t('orders.create.lineItems')}</CardTitle>
        <SalesOrderItemSearch onPick={addItem} />
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">{t('orders.create.rowNumber')}</TableHead>
              <TableHead className="w-[40%]">{t('orders.create.columns.description')}</TableHead>
              <TableHead className="w-[15%]">{t('orders.create.columns.qty')}</TableHead>
              <TableHead className="w-[15%]">{t('orders.create.columns.price')}</TableHead>
              <TableHead className="w-[15%]">{t('orders.create.columns.total')}</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {fields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  {t('orders.create.noItemsAddItem')}
                </TableCell>
              </TableRow>
            ) : (
              fields.map((item, index) => (
                <LineRow key={item.id} form={form} index={index} remove={remove} />
              ))
            )}
          </TableBody>
        </Table>
        <div className="p-4 flex justify-end items-center gap-4 border-t bg-muted/50">
          <span className="text-muted-foreground font-medium">{t('orders.create.totalAmount')}</span>
          <span className="text-2xl font-bold">{formatCurrency(currentTotal)}</span>
        </div>
      </CardContent>
    </Card>
  )
}

export default function SalesOrderCreate() {
  const { t } = useTranslation('sales')
  useEffect(() => {
    void ensureNamespaceLoaded('sales')
  }, [])
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const preselectedCustomerId = searchParams.get('customerId')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const { data: preselectedCustomer } = useCustomer(preselectedCustomerId || '')

  const form = useForm<SalesOrderForm>({
    defaultValues: {
      customer_id: '',
      notes: '',
      items: [],
    },
  })
  const lines = useFieldArray({ control: form.control, name: 'items' })
  const { saveStatus, finish: handleDone } = useSalesOrderDraft(form)

  useEffect(() => {
    if (preselectedCustomer) {
      setSelectedCustomer(preselectedCustomer)
      form.setValue('customer_id', preselectedCustomer.id, { shouldDirty: true })
    }
  }, [preselectedCustomer, form])

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        leading={
          <Button variant="ghost" size="icon" className="max-sm:min-h-11 max-sm:min-w-11" asChild>
            <button aria-label={t('orders.create.backAria')} onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Button>
        }
        title={t('orders.create.title')}
        description={t('orders.create.description')}
        actions={<DocumentSaveIndicator status={saveStatus} />}
      />

      <Form {...form}>
        <form onSubmit={(event) => event.preventDefault()} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('orders.create.customerDetails')}</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="customer_id"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>{t('orders.create.selectCustomer')}</FormLabel>
                    <FormControl>
                      <CustomerSearch
                        value={selectedCustomer}
                        onChange={(customer) => {
                          setSelectedCustomer(customer)
                          field.onChange(customer?.id ?? '')
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="mt-4">
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('orders.create.internalNotes')}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder={t('orders.detail.notesPlaceholder')} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <SalesOrderLinesCard form={form} lines={lines} />

          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => navigate('/sales-orders')}>
              {t('shared.cancel')}
            </Button>
            <Button type="button" size="lg" onClick={handleDone}>
              {t('orders.create.done')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}

import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Mail, Package, ReceiptText, Tags } from 'lucide-react'
import { toast } from 'sonner'
import { useVendor, useUpdateVendor } from '@/api/vendors'
import { BrandMultiSelect } from '@/components/BrandMultiSelect'
import { InlineEdit } from '@/components/inline-edit/InlineEdit'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatCurrency } from '@/lib/utils'
import { parseLocalDate } from '@/lib/date-utils'
import type {
  Brand,
  PurchaseInvoiceStatus,
  PurchaseOrderStatus,
  Vendor,
} from '@/api/types'

type VendorPurchaseOrderItemSummary = {
  quantity: string | number
  unit_cost: string | number
}

type VendorPurchaseOrderSummary = {
  id: string
  order_number: string
  status: PurchaseOrderStatus
  createdAt: string
  items?: VendorPurchaseOrderItemSummary[]
}

type VendorPurchaseInvoiceSummary = {
  id: string
  invoice_number?: string | null
  vendor_invoice_number: string
  status: PurchaseInvoiceStatus
  invoice_date: string
  total_amount: string | number
}

type VendorDetailResponse = Vendor & {
  purchase_orders?: VendorPurchaseOrderSummary[]
  purchase_invoices?: VendorPurchaseInvoiceSummary[]
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function getPurchaseOrderTotal(order: VendorPurchaseOrderSummary) {
  return (order.items ?? []).reduce(
    (sum, item) => sum + toNumber(item.quantity) * toNumber(item.unit_cost),
    0,
  )
}

export default function VendorDetail() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const { data: vendor, isLoading, error } = useVendor<VendorDetailResponse>(id ?? '')
  const updateVendor = useUpdateVendor()
  const [selectedBrandIds, setSelectedBrandIds] = useState<number[]>(() => 
    (vendor?.supportedBrands ?? []).map((brand) => brand.id)
  )

  if (isLoading) {
    return <div className='p-8 text-center'>Loading vendor details...</div>
  }

  if (error) {
    return <div className='p-8 text-center'>Failed to load vendor: {(error as Error).message}</div>
  }

  if (!vendor) {
    return <div className='p-8 text-center'>Vendor not found.</div>
  }

  const activeOrders = (vendor.purchase_orders ?? [])
    .filter((order) => order.status !== 'COMPLETED')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  type EditableVendorField = 'name' | 'email' | 'account_number'

  const handleSaveVendorField = async (
    field: EditableVendorField,
    nextValue: string,
  ) => {
    try {
      await updateVendor.mutateAsync({
        id: vendor.id,
        data: {
          [field]: nextValue,
        },
      })
      toast.success('Vendor updated')
    } catch (updateError: unknown) {
      if (updateError instanceof Error) {
        toast.error(updateError.message)
      } else {
        toast.error('Failed to update vendor')
      }
      throw updateError
    }
  }

  const handleSaveBrands = async () => {
    try {
      await updateVendor.mutateAsync({
        id: vendor.id,
        data: {
          brandIds: selectedBrandIds,
        },
      })
      toast.success('Supported brands updated')
    } catch (updateError: unknown) {
      if (updateError instanceof Error) {
        toast.error(updateError.message)
      } else {
        toast.error('Failed to update brands')
      }
    }
  }

  return (
    <div className='w-full max-w-7xl mx-auto p-6 space-y-6'>
      <div className='flex items-center justify-between mb-8'>
        <div className='flex items-center gap-4'>
          <Button variant='ghost' size='icon' asChild>
            <Link to='/vendors' aria-label='Back to vendors'>
              <ArrowLeft className='h-4 w-4' />
            </Link>
          </Button>
          <div>
            <h1 className='text-2xl font-semibold tracking-tight'>{vendor.name}</h1>
            <div className='flex items-center gap-2 text-slate-500 text-sm'>
              <span>ID: {vendor.id.substring(0, 8)}</span>
            </div>
          </div>
        </div>
        <div className='flex gap-2'>
          <Button asChild>
            <Link to={`/purchase-orders/new?vendorId=${vendor.id}`}>
              <Package className='mr-2 h-4 w-4' /> Purchase Order
            </Link>
          </Button>
          <Button variant='outline' asChild>
            <Link to={`/purchase-bills/new?vendorId=${vendor.id}`}>
              <ReceiptText className='mr-2 h-4 w-4' /> Purchase Bill
            </Link>
          </Button>
        </div>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 items-start'>
        <Card className='lg:col-span-1'>
          <CardHeader>
            <CardTitle className='text-base font-semibold'>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div>
              <div className='text-xs text-muted-foreground mb-1'>Vendor Name</div>
              <InlineEdit
                value={vendor.name}
                onSave={(nextValue) => handleSaveVendorField('name', nextValue)}
                placeholder='Vendor name'
                emptyText='Add vendor name'
                ariaLabel='Vendor name'
              />
            </div>
            <div className='flex items-center gap-2'>
              <Mail className='h-4 w-4 text-muted-foreground' />
              <InlineEdit
                value={vendor.email}
                onSave={(nextValue) => handleSaveVendorField('email', nextValue)}
                placeholder='vendor@example.com'
                emptyText='Add email'
                ariaLabel='Vendor email'
              />
            </div>
            <div className='pt-2 border-t'>
              <span className='text-sm font-medium'>Account #:</span>
              <div className='mt-1'>
                <InlineEdit
                  value={vendor.account_number}
                  onSave={(nextValue) => handleSaveVendorField('account_number', nextValue)}
                  placeholder='Account number'
                  emptyText='Add account number'
                  ariaLabel='Vendor account number'
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className='lg:col-span-2'>
          <Tabs defaultValue='orders'>
            <TabsList>
              <TabsTrigger value='orders'>Active Orders</TabsTrigger>
              <TabsTrigger value='invoices'>Invoice History</TabsTrigger>
              <TabsTrigger value='brands'>Supported Brands</TabsTrigger>
            </TabsList>

            <TabsContent value='orders' className='mt-4'>
              <Card>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className='text-right'>Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeOrders.map((order) => (
                        <TableRow
                          key={order.id}
                          className='cursor-pointer hover:bg-accent/50'
                          onClick={() => navigate(`/purchase-orders/${order.id}`)}
                          tabIndex={0}
                          role='button'
                          aria-label={`Open purchase order ${order.order_number}`}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              navigate(`/purchase-orders/${order.id}`)
                            }
                          }}
                        >
                          <TableCell className='font-medium'>{order.order_number}</TableCell>
                          <TableCell>{parseLocalDate(order.createdAt)?.toLocaleDateString() || '-'}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(getPurchaseOrderTotal(order))}</TableCell>
                        </TableRow>
                      ))}
                      {activeOrders.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>No active purchase orders</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='invoices' className='mt-4'>
              <Card>
                <CardContent className='p-0'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice #</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className='text-right'>Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(vendor.purchase_invoices ?? []).map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell className='font-medium'>
                            {invoice.invoice_number || invoice.vendor_invoice_number || 'Draft'}
                          </TableCell>
                          <TableCell>{parseLocalDate(invoice.invoice_date)?.toLocaleDateString() || '-'}</TableCell>
                          <TableCell><StatusBadge status={invoice.status} /></TableCell>
                          <TableCell className='text-right'>{formatCurrency(toNumber(invoice.total_amount))}</TableCell>
                        </TableRow>
                      ))}
                      {(vendor.purchase_invoices ?? []).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} className='text-center py-4 text-muted-foreground'>No recent purchase invoices</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value='brands' className='mt-4'>
              <Card>
                <CardHeader className='pb-3'>
                  <CardTitle className='text-base font-semibold flex items-center gap-2'>
                    <Tags className='h-4 w-4' />
                    Brand Mapping
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-4'>
                  <BrandMultiSelect value={selectedBrandIds} onChange={setSelectedBrandIds} />
                  <div className='flex justify-end'>
                    <Button
                      onClick={() => void handleSaveBrands()}
                      disabled={updateVendor.isPending}
                    >
                      Save Brands
                    </Button>
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    Current: {(vendor.supportedBrands ?? []).map((brand: Brand) => brand.name).join(', ') || 'No brands selected'}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}

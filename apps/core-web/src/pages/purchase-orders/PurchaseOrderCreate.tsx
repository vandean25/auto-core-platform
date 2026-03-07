import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useVendors } from '@/api/vendors'
import { useCreatePO } from '@/api/purchase-orders'
import { useBrands } from '@/api/brands'
import { Button } from '@/components/ui/button'
import { toast } from "sonner"
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'
import type { Brand, Vendor } from '@/api/types'

export default function PurchaseOrderCreate() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const [step, setStep] = useState(1)

    // Step 1: Brand
    const { data: brands, isLoading: isLoadingBrands } = useBrands()
    const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null)

    // Step 2: Vendor
    const { data: vendorsResponse } = useVendors()
    const vendors = (Array.isArray(vendorsResponse) ? vendorsResponse : (vendorsResponse as any)?.data || []) as Vendor[]

    // Compute valid vendor ID based on params, brand, and available vendors
    const computeValidVendorId = () => {
        const vendorIdFromParams = searchParams.get('vendorId') ?? ''
        if (!vendorIdFromParams) return ''

        const filteredVendors = selectedBrand
            ? vendors.filter((v: Vendor) => v.supportedBrands.some((b: Brand) => b.id === selectedBrand.id))
            : vendors

        const vendorExists = filteredVendors.some((v: Vendor) => v.id === vendorIdFromParams)
        return vendorExists ? vendorIdFromParams : ''
    }

    const [selectedVendorId, setSelectedVendorId] = useState<string>(computeValidVendorId())

    const createPO = useCreatePO()

    const filteredVendors = vendors?.filter((v: Vendor) =>
        selectedBrand ? v.supportedBrands.some((b: Brand) => b.id === selectedBrand.id) : true
    )

    const handleCreatePO = () => {
        if (!selectedVendorId) return
        createPO.mutate({
            vendorId: selectedVendorId,
            items: [], // Create empty PO
        }, {
            onSuccess: (data) => navigate(`/purchase-orders/${data.id}`),
            onError: (error) => {
                toast.error("Failed to create PO", {
                    description: error.message,
                })
            }
        })
    }

    return (
        <div className="w-full max-w-7xl mx-auto p-6 space-y-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Create Purchase Order</h1>
                </div>
            </div>

            {/* Steps Indicator */}
            <div className="flex space-x-4 mb-8">
                {[1, 2].map(s => (
                    <div key={s} className={cn("h-2 flex-1 rounded-full", s <= step ? "bg-primary" : "bg-muted")} />
                ))}
            </div>

            {step === 1 && (
                <div className="space-y-4">
                    <h2 className="text-xl font-semibold">Step 1: Select Brand</h2>
                    {isLoadingBrands ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            {brands?.map(brand => (
                                <Button
                                    key={brand.id}
                                    variant={selectedBrand?.id === brand.id ? "default" : "outline"}
                                    className="h-24 flex flex-col gap-2 p-4"
                                    onClick={() => {
                                        setSelectedBrand(brand)
                                        setStep(2)
                                    }}
                                >
                                    {brand.logoUrl && <img src={brand.logoUrl} className="h-8 object-contain" alt="" />}
                                    <span className={brand.logoUrl ? "text-xs" : "text-lg"}>{brand.name}</span>
                                </Button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {step === 2 && (
                <div className="space-y-4">
                    <h2 className="text-xl font-semibold">Step 2: Select Vendor</h2>
                    <p className="text-muted-foreground">Showing vendors for <strong>{selectedBrand?.name}</strong></p>

                    <div className="grid gap-4">
                        {filteredVendors?.length === 0 ? (
                            <div className="text-red-500">No vendors found for this brand.</div>
                        ) : (
                            <div className="grid grid-cols-1 gap-2">
                                {filteredVendors?.map((vendor: Vendor) => (
                                    <div
                                        key={vendor.id}
                                        className={cn(
                                            "p-4 border rounded cursor-pointer hover:bg-muted/50",
                                            selectedVendorId === vendor.id ? "border-primary bg-muted/50" : ""
                                        )}
                                        onClick={() => setSelectedVendorId(vendor.id)}
                                    >
                                        <div className="font-bold">{vendor.name}</div>
                                        <div className="text-sm text-muted-foreground">{vendor.email}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-between mt-8">
                        <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                        <Button 
                            onClick={handleCreatePO} 
                            disabled={!selectedVendorId || createPO.isPending}
                        >
                            {createPO.isPending ? 'Creating...' : 'Create Purchase Order'}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

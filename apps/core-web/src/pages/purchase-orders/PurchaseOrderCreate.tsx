import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useVendors } from '@/api/vendors'
import { useBrands } from '@/api/brands'
import { Button } from '@/components/ui/button'
import { DocumentSaveIndicator } from '@/components/document-save/DocumentSaveIndicator'
import { cn } from '@/lib/utils'
import type { Brand, Vendor } from '@/api/types'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { PageHeader } from '@/components/layout/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import { usePurchaseOrderDraft } from './usePurchaseOrderDraft'

function supportsBrand(vendor: Vendor, brand: Brand | null) {
    return brand ? (vendor.supportedBrands ?? []).some((b: Brand) => b.id === brand.id) : true
}

function BrandSkeleton() {
    const { t: tCommon } = useTranslation('common')

    return (
        <div role="status" aria-busy="true" className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <span className="sr-only">{tCommon('shell.loading')}</span>
            {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-24 w-full" />
            ))}
        </div>
    )
}

type StepProps = {
    selectedBrand: Brand | null
    selectedVendorId: string
    setSelectedBrand: (brand: Brand) => void
    setSelectedVendorId: (id: string) => void
    setStep: (step: number) => void
}

function BrandStep({
    brands,
    isLoading,
    selectedBrand,
    setSelectedBrand,
    setSelectedVendorId,
    setStep,
}: Pick<StepProps, 'selectedBrand' | 'setSelectedBrand' | 'setSelectedVendorId' | 'setStep'> & {
    brands: Brand[] | undefined
    isLoading: boolean
}) {
    const { t } = useTranslation('finance')

    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold">{t('purchaseOrders.create.stepBrand')}</h2>
            {isLoading ? (
                <BrandSkeleton />
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {brands?.map(brand => (
                        <Button
                            key={brand.id}
                            variant={selectedBrand?.id === brand.id ? "default" : "outline"}
                            className="h-24 flex flex-col gap-2 p-4"
                            onClick={() => {
                                setSelectedBrand(brand)
                                setSelectedVendorId('')
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
    )
}

function VendorChoices({
    vendors,
    selectedVendorId,
    setSelectedVendorId,
}: {
    vendors: Vendor[]
    selectedVendorId: string
    setSelectedVendorId: (id: string) => void
}) {
    const { t } = useTranslation('finance')

    if (vendors.length === 0) {
        return <div className="text-destructive">{t('purchaseOrders.create.noVendorsForBrand')}</div>
    }

    return (
        <div className="grid grid-cols-1 gap-2">
            {vendors.map((vendor: Vendor) => (
                <button
                    type="button"
                    key={vendor.id}
                    className={cn(
                        "w-full p-4 border rounded text-left hover:bg-muted/50",
                        selectedVendorId === vendor.id ? "border-primary bg-muted/50" : ""
                    )}
                    aria-pressed={selectedVendorId === vendor.id}
                    onClick={() => setSelectedVendorId(vendor.id)}
                >
                    <span className="block font-bold">{vendor.name}</span>
                    <span className="block text-sm text-muted-foreground">{vendor.email}</span>
                </button>
            ))}
        </div>
    )
}

function VendorStep({
    vendors,
    selectedBrand,
    selectedVendorId,
    setSelectedVendorId,
    setStep,
    clearPendingSave,
    handleCreatePO,
    isCreating,
}: Pick<StepProps, 'selectedBrand' | 'selectedVendorId' | 'setSelectedVendorId' | 'setStep'> & {
    vendors: Vendor[]
    clearPendingSave: () => void
    handleCreatePO: () => void
    isCreating: boolean
}) {
    const { t } = useTranslation('finance')

    return (
        <div className="space-y-4">
            <h2 className="text-xl font-semibold">{t('purchaseOrders.create.stepVendor')}</h2>
            <p className="text-muted-foreground">
                {t('purchaseOrders.create.vendorsForBrand', { brand: selectedBrand?.name ?? '' })}
            </p>

            <div className="grid gap-4">
                <VendorChoices
                    vendors={vendors}
                    selectedVendorId={selectedVendorId}
                    setSelectedVendorId={setSelectedVendorId}
                />
            </div>

            <div className="flex justify-between mt-8">
                <Button variant="outline" onClick={() => {
                    clearPendingSave()
                    setStep(1)
                }}>{t('actions.back')}</Button>
                <Button
                    className="max-sm:min-h-11"
                    onClick={handleCreatePO}
                    disabled={!selectedVendorId || isCreating}
                >
                    {isCreating ? t('shared.creating') : t('purchaseOrders.create.createButton')}
                </Button>
            </div>
        </div>
    )
}

export default function PurchaseOrderCreate() {
    const { t } = useTranslation('finance')
    useEffect(() => {
        void ensureNamespaceLoaded('finance')
    }, [])

    const [searchParams] = useSearchParams()
    const [step, setStep] = useState(1)

    const { data: brands, isLoading: isLoadingBrands } = useBrands()
    const [selectedBrand, setSelectedBrand] = useState<Brand | null>(null)

    const { data: vendorsResponse } = useVendors()
    const vendors: Vendor[] = vendorsResponse?.data ?? []

    const vendorIdFromParams = searchParams.get('vendorId') ?? ''
    const initialVendorExists = vendors.some((v) => v.id === vendorIdFromParams && supportsBrand(v, selectedBrand))
    const [selectedVendorId, setSelectedVendorId] = useState<string>(initialVendorExists ? vendorIdFromParams : '')

    const selectedVendor = vendors.find((vendor) => vendor.id === selectedVendorId)
    const { saveStatus, triggerAutoSave, clearPendingSave, isPending } = usePurchaseOrderDraft(
        selectedVendorId,
        selectedVendor?.name ?? '',
    )
    const filteredVendors = vendors.filter((v) => supportsBrand(v, selectedBrand))

    const handleCreatePO = () => {
        if (!selectedVendorId) return
        triggerAutoSave({ vendorId: selectedVendorId, vendorName: selectedVendor?.name ?? '' }, { immediate: true })
    }

    return (
        <div className="space-y-8">
            <PageHeader title={t('purchaseOrders.create.title')} actions={<DocumentSaveIndicator status={saveStatus} />} />

            <div className="flex space-x-4 mb-8">
                {[1, 2].map(s => (
                    <div key={s} className={cn("h-2 flex-1 rounded-full", s <= step ? "bg-primary" : "bg-muted")} />
                ))}
            </div>

            {step === 1 && (
                <BrandStep
                    brands={brands}
                    isLoading={isLoadingBrands}
                    selectedBrand={selectedBrand}
                    setSelectedBrand={setSelectedBrand}
                    setSelectedVendorId={setSelectedVendorId}
                    setStep={setStep}
                />
            )}

            {step === 2 && (
                <VendorStep
                    vendors={filteredVendors}
                    selectedBrand={selectedBrand}
                    selectedVendorId={selectedVendorId}
                    setSelectedVendorId={setSelectedVendorId}
                    setStep={setStep}
                    clearPendingSave={clearPendingSave}
                    handleCreatePO={handleCreatePO}
                    isCreating={isPending}
                />
            )}
        </div>
    )
}

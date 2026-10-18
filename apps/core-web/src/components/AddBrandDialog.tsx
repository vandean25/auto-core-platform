import * as React from "react"
import { useTranslation } from "react-i18next"
import { Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useCreateBrand, useUpdateBrand } from "@/api/brands"
import type { Brand } from "@/api/types"
import { getErrorMessage } from "@/lib/error-utils"

interface AddBrandDialogProps {
    brand?: Brand | null
    onClose?: () => void
}

export function AddBrandDialog({ brand, onClose }: AddBrandDialogProps) {
    const { t } = useTranslation(['settings', 'common'])
    const [open, setOpen] = React.useState(false)
    const createMutation = useCreateBrand()
    const updateMutation = useUpdateBrand()

    React.useEffect(() => {
        if (brand) setOpen(true)
    }, [brand])

    const handleClose = (isOpen: boolean) => {
        setOpen(isOpen)
        if (!isOpen && onClose) onClose()
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        const name = formData.get("name") as string
        const logoUrl = formData.get("logoUrl") as string
        const isVehicleMake = formData.get("isVehicleMake") === "on"
        const isPartManufacturer = formData.get("isPartManufacturer") === "on"

        if (!isVehicleMake && !isPartManufacturer) {
            toast.error(t('brands.toast.typeRequired'))
            return
        }

        try {
            if (brand) {
                await updateMutation.mutateAsync({
                    id: brand.id,
                    name,
                    isVehicleMake,
                    isPartManufacturer,
                    logoUrl: logoUrl || undefined
                })
                toast.success(t('brands.toast.updated'))
            } else {
                await createMutation.mutateAsync({
                    name,
                    isVehicleMake,
                    isPartManufacturer,
                    logoUrl: logoUrl || undefined
                })
                toast.success(t('brands.toast.created'))
            }
            handleClose(false)
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, t('brands.toast.saveFailed')))
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            {!brand && (
                <DialogTrigger asChild>
                    <Button size="sm">
                        <Plus className="mr-2 h-4 w-4" /> {t('brands.addDialog.trigger')}
                    </Button>
                </DialogTrigger>
            )}
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{brand ? t('brands.addDialog.editTitle') : t('brands.addDialog.addTitle')}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">{t('brands.addDialog.name')}</Label>
                            <Input id="name" name="name" defaultValue={brand?.name} placeholder={t('brands.addDialog.namePlaceholder')} required />
                        </div>
                        <div className="space-y-4">
                            <Label>{t('brands.addDialog.typesLabel')}</Label>
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center space-x-2">
                                    <Checkbox id="isVehicleMake" name="isVehicleMake" defaultChecked={brand?.isVehicleMake} />
                                    <Label htmlFor="isVehicleMake" className="font-normal">{t('brands.addDialog.vehicleMake')}</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Checkbox id="isPartManufacturer" name="isPartManufacturer" defaultChecked={brand?.isPartManufacturer} />
                                    <Label htmlFor="isPartManufacturer" className="font-normal">{t('brands.addDialog.partManufacturer')}</Label>
                                </div>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="logoUrl">{t('brands.addDialog.logoUrl')}</Label>
                            <Input id="logoUrl" name="logoUrl" defaultValue={brand?.logoUrl ?? ''} placeholder={t('brands.addDialog.logoUrlPlaceholder')} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => handleClose(false)}>{t('common:actions.cancel')}</Button>
                        <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                            {brand ? t('brands.addDialog.saveChanges') : t('brands.addDialog.create')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

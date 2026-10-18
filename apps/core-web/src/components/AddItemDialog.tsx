import * as React from "react"
import { Plus } from "lucide-react"
import { useTranslation } from 'react-i18next'
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
import { BrandCombobox } from "@/components/BrandCombobox"
import { useCreateInventoryItem } from "@/api/inventory"
import { getErrorMessage } from "@/lib/error-utils"

export function AddItemDialog() {
    const { t } = useTranslation(['inventory', 'common'])
    const [open, setOpen] = React.useState(false)
    const [selectedBrandId, setSelectedBrandId] = React.useState<number | undefined>()
    const createMutation = useCreateInventoryItem()

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)
        
        try {
            await createMutation.mutateAsync({
                sku: formData.get("sku") as string,
                name: formData.get("name") as string,
                cost_price: parseFloat(formData.get("cost_price") as string),
                retail_price: parseFloat(formData.get("retail_price") as string),
                brandId: selectedBrandId,
            })
            
            toast.success(t('inventory:addItemDialog.created'))
            setOpen(false)
            setSelectedBrandId(undefined)
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, t('inventory:addItemDialog.createFailed')))
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="mr-2 h-4 w-4" /> {t('inventory:addItemDialog.trigger')}
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{t('inventory:addItemDialog.title')}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="sku">{t('inventory:addItemDialog.sku')}</Label>
                                <Input id="sku" name="sku" placeholder={t('inventory:addItemDialog.skuPlaceholder')} required />
                            </div>
                            <div className="grid gap-2">
                                <Label>{t('inventory:addItemDialog.brand')}</Label>
                                <BrandCombobox value={selectedBrandId} onChange={setSelectedBrandId} />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="name">{t('inventory:addItemDialog.name')}</Label>
                            <Input id="name" name="name" placeholder={t('inventory:addItemDialog.namePlaceholder')} required />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="cost_price">{t('inventory:addItemDialog.costPrice')}</Label>
                                <Input id="cost_price" name="cost_price" type="number" step="0.01" required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="retail_price">{t('inventory:addItemDialog.retailPrice')}</Label>
                                <Input id="retail_price" name="retail_price" type="number" step="0.01" required />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('common:actions.cancel')}</Button>
                        <Button type="submit" disabled={createMutation.isPending}>
                            {createMutation.isPending ? t('inventory:addItemDialog.creating') : t('inventory:addItemDialog.trigger')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

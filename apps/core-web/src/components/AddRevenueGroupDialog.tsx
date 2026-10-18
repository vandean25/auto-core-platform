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
import { useCreateRevenueGroup } from "@/api/useFinance"

/**
 * Dialog for creating a finance revenue group from settings.
 */
export function AddRevenueGroupDialog() {
    const { t } = useTranslation(['settings', 'common'])
    const [open, setOpen] = React.useState(false)
    const createMutation = useCreateRevenueGroup()

    /**
     * Collects form values and submits a typed create payload to the API.
     */
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const formData = new FormData(e.currentTarget)

        try {
            await createMutation.mutateAsync({
                name: formData.get("name") as string,
                tax_rate: parseFloat(formData.get("tax_rate") as string),
                account_number: formData.get("account_number") as string,
                is_default: formData.get("is_default") === "on",
            })

            toast.success(t('revenueGroups.toast.created'))
            setOpen(false)
        } catch (error) {
            toast.error(t('revenueGroups.toast.createFailed'))
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" /> {t('revenueGroups.addDialog.trigger')}
                </Button>
            </DialogTrigger>
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{t('revenueGroups.addDialog.title')}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">{t('revenueGroups.addDialog.name')}</Label>
                            <Input id="name" name="name" placeholder={t('revenueGroups.addDialog.namePlaceholder')} required />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="tax_rate">{t('revenueGroups.addDialog.taxRate')}</Label>
                                <Input id="tax_rate" name="tax_rate" type="number" step="0.01" defaultValue="20.00" required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="account_number">{t('revenueGroups.addDialog.accountNumber')}</Label>
                                <Input id="account_number" name="account_number" placeholder={t('revenueGroups.addDialog.accountPlaceholder')} required />
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox id="is_default" name="is_default" />
                            <Label htmlFor="is_default">{t('revenueGroups.addDialog.defaultCheckbox')}</Label>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t('common:actions.cancel')}</Button>
                        <Button type="submit" disabled={createMutation.isPending}>
                            {createMutation.isPending ? t('revenueGroups.addDialog.creating') : t('revenueGroups.addDialog.create')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

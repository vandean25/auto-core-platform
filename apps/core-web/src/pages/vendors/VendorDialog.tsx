import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreateVendor } from '@/api/vendors'
import { Button } from '@/components/ui/button'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { BrandMultiSelect } from '@/components/BrandMultiSelect'
import { ensureNamespaceLoaded } from '@/lib/i18n'

interface VendorDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function VendorDialog({ open, onOpenChange }: VendorDialogProps) {
    const { t } = useTranslation('finance')
    useEffect(() => {
        void ensureNamespaceLoaded('finance')
    }, [])

    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [accountNumber, setAccountNumber] = useState('')
    const [selectedBrandIds, setSelectedBrandIds] = useState<number[]>([])

    const createVendor = useCreateVendor()

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        createVendor.mutate(
            {
                name,
                email,
                account_number: accountNumber,
                brandIds: selectedBrandIds,
            },
            {
                onSuccess: () => {
                    onOpenChange(false)
                    resetForm()
                },
            }
        )
    }

    const resetForm = () => {
        setName('')
        setEmail('')
        setAccountNumber('')
        setSelectedBrandIds([])
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>{t('vendors.dialog.title')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">{t('columns.name')}</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="email">{t('columns.email')}</Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="accountNumber">{t('vendors.dialog.accountNumber')}</Label>
                        <Input
                            id="accountNumber"
                            value={accountNumber}
                            onChange={(e) => setAccountNumber(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>{t('columns.supportedBrands')}</Label>
                        <BrandMultiSelect 
                            value={selectedBrandIds} 
                            onChange={setSelectedBrandIds} 
                            ariaLabel={t('vendors.dialog.supportedBrandsAria')}
                        />
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={createVendor.isPending}>
                            {createVendor.isPending ? t('shared.saving') : t('vendors.dialog.saveVendor')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

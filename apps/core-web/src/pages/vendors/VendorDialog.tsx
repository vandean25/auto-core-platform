import { useState } from 'react'
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

interface VendorDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function VendorDialog({ open, onOpenChange }: VendorDialogProps) {
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
                    <DialogTitle>Add Vendor</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Name</Label>
                        <Input
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="accountNumber">Account Number</Label>
                        <Input
                            id="accountNumber"
                            value={accountNumber}
                            onChange={(e) => setAccountNumber(e.target.value)}
                            required
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label>Supported Brands</Label>
                        <BrandMultiSelect 
                            value={selectedBrandIds} 
                            onChange={setSelectedBrandIds} 
                        />
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={createVendor.isPending}>
                            {createVendor.isPending ? 'Saving...' : 'Save Vendor'}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
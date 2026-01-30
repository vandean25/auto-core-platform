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
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'

const POPULAR_BRANDS = [
    'VW',
    'Audi',
    'BMW',
    'Mercedes-Benz',
    'Ford',
    'Toyota',
    'Honda',
    'Porsche',
    'Opel',
    'Skoda',
]

interface VendorDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function VendorDialog({ open, onOpenChange }: VendorDialogProps) {
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [accountNumber, setAccountNumber] = useState('')
    const [selectedBrands, setSelectedBrands] = useState<string[]>([])

    const createVendor = useCreateVendor()

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        createVendor.mutate(
            {
                name,
                email,
                account_number: accountNumber,
                supported_brands: selectedBrands,
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
        setSelectedBrands([])
    }

    const toggleBrand = (brand: string) => {
        setSelectedBrands((prev) =>
            prev.includes(brand)
                ? prev.filter((b) => b !== brand)
                : [...prev, brand]
        )
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
                        <ScrollArea className="h-[150px] w-full rounded-md border p-4">
                            <div className="grid grid-cols-2 gap-2">
                                {POPULAR_BRANDS.map((brand) => (
                                    <div key={brand} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={`brand-${brand}`}
                                            checked={selectedBrands.includes(brand)}
                                            onCheckedChange={() => toggleBrand(brand)}
                                        />
                                        <label
                                            htmlFor={`brand-${brand}`}
                                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                        >
                                            {brand}
                                        </label>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
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

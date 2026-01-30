import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVendors } from '@/api/vendors'
import { useInventory } from '@/api/inventory'
import { useCreatePO } from '@/api/purchase-orders'
import { Button } from '@/components/ui/button'
import { toast } from "sonner"
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty, CommandGroup } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Check, ChevronsUpDown, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const BRANDS = ['VW', 'Audi', 'BMW', 'Mercedes-Benz', 'Ford', 'Toyota', 'Honda', 'Porsche', 'Opel', 'Skoda']

interface POItem {
    catalogItemId: string
    name: string
    sku: string
    quantity: number
    unitCost: number
}

interface InventoryItem {
    id: string
    name: string
    sku: string
    price: number
    quantity_available: number
    brand: string
}

export default function PurchaseOrderCreate() {
    const navigate = useNavigate()
    const [step, setStep] = useState(1)

    // Step 1: Brand
    const [selectedBrand, setSelectedBrand] = useState<string>('')

    // Step 2: Vendor
    const { data: vendors } = useVendors()
    const [selectedVendorId, setSelectedVendorId] = useState<string>('')

    // Step 3: Items
    const [items, setItems] = useState<POItem[]>([])
    const [itemSearch, setItemSearch] = useState('')
    const { data: inventory } = useInventory({ search: itemSearch, limit: 10, brand: selectedBrand })
    const [openCombobox, setOpenCombobox] = useState(false)

    const createPO = useCreatePO()

    const filteredVendors = vendors?.filter(v =>
        selectedBrand ? v.supported_brands.includes(selectedBrand) : true
    )

    const handleAddItem = (item: InventoryItem) => {
        if (items.find(i => i.catalogItemId === item.id)) return
        setItems([...items, {
            catalogItemId: item.id,
            name: item.name,
            sku: item.sku,
            quantity: 1,
            unitCost: item.price // Defaulting to price as cost is not in inventory list type explicitly sometimes, but let's assume price. 
            // Ideally cost_price should be in CatalogItem and returned. 
            // For now using price as placeholder.
        }])
        setOpenCombobox(false)
    }

    const updateItem = (id: string, field: 'quantity' | 'unitCost', value: number) => {
        setItems(items.map(i => i.catalogItemId === id ? { ...i, [field]: value } : i))
    }

    const removeItem = (id: string) => {
        setItems(items.filter(i => i.catalogItemId !== id))
    }

    const handleSubmit = () => {
        if (!selectedVendorId || items.length === 0) return
        createPO.mutate({
            vendorId: selectedVendorId,
            items: items.map(i => ({
                catalogItemId: i.catalogItemId,
                quantity: i.quantity,
                unitCost: i.unitCost
            }))
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
        <div className="p-8 max-w-4xl mx-auto space-y-8">
            <h1 className="text-2xl font-bold">Create Purchase Order</h1>

            {/* Steps Indicator */}
            <div className="flex space-x-4 mb-8">
                {[1, 2, 3].map(s => (
                    <div key={s} className={cn("h-2 flex-1 rounded-full", s <= step ? "bg-primary" : "bg-muted")} />
                ))}
            </div>

            {step === 1 && (
                <div className="space-y-4">
                    <h2 className="text-xl font-semibold">Step 1: Select Brand</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {BRANDS.map(brand => (
                            <Button
                                key={brand}
                                variant={selectedBrand === brand ? "default" : "outline"}
                                className="h-20 text-lg"
                                onClick={() => setSelectedBrand(brand)}
                            >
                                {brand}
                            </Button>
                        ))}
                    </div>
                    <div className="flex justify-end mt-8">
                        <Button onClick={() => setStep(2)} disabled={!selectedBrand}>Next</Button>
                    </div>
                </div>
            )}

            {step === 2 && (
                <div className="space-y-4">
                    <h2 className="text-xl font-semibold">Step 2: Select Vendor</h2>
                    <p className="text-muted-foreground">Showing vendors for <strong>{selectedBrand}</strong></p>

                    <div className="grid gap-4">
                        {filteredVendors?.length === 0 ? (
                            <div className="text-red-500">No vendors found for this brand.</div>
                        ) : (
                            <div className="grid grid-cols-1 gap-2">
                                {filteredVendors?.map(vendor => (
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
                        <Button onClick={() => setStep(3)} disabled={!selectedVendorId}>Next</Button>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="space-y-4">
                    <h2 className="text-xl font-semibold">Step 3: Add Items</h2>

                    {/* Item Search */}
                    <div className="flex flex-col space-y-2">
                        <Label>Search Catalog</Label>
                        <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={openCombobox}
                                    className="w-full justify-between"
                                >
                                    Select item...
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0" align="start">
                                <Command shouldFilter={false}>
                                    {/* We handle filtering via API search param, so disable local command filtering or coordinate them.
                    For simplicity, we let user type in input which triggers 'itemSearch' state change.
                 */}
                                    <CommandInput placeholder="Search SKU or Name..." onValueChange={setItemSearch} />
                                    <CommandList>
                                        <CommandEmpty>No item found.</CommandEmpty>
                                        <CommandGroup>
                                            {inventory?.data.map((item) => (
                                                <CommandItem
                                                    key={item.id}
                                                    value={item.id} // value is used for selection
                                                    onSelect={() => handleAddItem(item)}
                                                >
                                                    <Check
                                                        className={cn(
                                                            "mr-2 h-4 w-4",
                                                            items.find(i => i.catalogItemId === item.id) ? "opacity-100" : "opacity-0"
                                                        )}
                                                    />
                                                    <div className="flex flex-col">
                                                        <span>{item.sku} - {item.name}</span>
                                                        <span className="text-xs text-muted-foreground">Stock: {item.quantity_available} | {item.brand}</span>
                                                    </div>
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Items Table */}
                    <div className="border rounded-md">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>SKU</TableHead>
                                    <TableHead>Name</TableHead>
                                    <TableHead className="w-[100px]">Qty</TableHead>
                                    <TableHead className="w-[100px]">Cost</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {items.map(item => (
                                    <TableRow key={item.catalogItemId}>
                                        <TableCell>{item.sku}</TableCell>
                                        <TableCell>{item.name}</TableCell>
                                        <TableCell>
                                            <Input
                                                type="number"
                                                min="1"
                                                value={item.quantity}
                                                onChange={(e) => updateItem(item.catalogItemId, 'quantity', parseInt(e.target.value))}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={item.unitCost}
                                                onChange={(e) => updateItem(item.catalogItemId, 'unitCost', parseFloat(e.target.value))}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Button size="icon" variant="ghost" onClick={() => removeItem(item.catalogItemId)}>
                                                <Trash2 className="h-4 w-4 text-red-500" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {items.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center text-muted-foreground">No items added yet.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="flex justify-between mt-8">
                        <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
                        <Button onClick={handleSubmit} disabled={items.length === 0 || createPO.isPending}>
                            {createPO.isPending ? 'Creating...' : 'Create Purchase Order'}
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

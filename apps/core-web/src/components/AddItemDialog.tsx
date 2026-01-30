import * as React from "react"
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
import { BrandCombobox } from "@/components/BrandCombobox"
import { useCreateInventoryItem } from "@/api/inventory"

export function AddItemDialog() {
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
            
            toast.success("Inventory item created")
            setOpen(false)
            setSelectedBrandId(undefined)
        } catch (error: any) {
            toast.error(error.message || "Failed to create item")
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button>
                    <Plus className="mr-2 h-4 w-4" /> Add Item
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Add Inventory Item</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="sku">SKU / MPN</Label>
                                <Input id="sku" name="sku" placeholder="e.g., OF-1001" required />
                            </div>
                            <div className="grid gap-2">
                                <Label>Brand</Label>
                                <BrandCombobox value={selectedBrandId} onChange={setSelectedBrandId} />
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="name">Item Name</Label>
                            <Input id="name" name="name" placeholder="e.g., Oil Filter" required />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="cost_price">Cost Price (€)</Label>
                                <Input id="cost_price" name="cost_price" type="number" step="0.01" required />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="retail_price">Retail Price (€)</Label>
                                <Input id="retail_price" name="retail_price" type="number" step="0.01" required />
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button type="submit" disabled={createMutation.isPending}>
                            {createMutation.isPending ? "Creating..." : "Create Item"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

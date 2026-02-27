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
import { Checkbox } from "@/components/ui/checkbox"
import { useCreateBrand, useUpdateBrand } from "@/api/brands"
import type { Brand } from "@/api/types"

interface AddBrandDialogProps {
    brand?: Brand | null
    onClose?: () => void
}

export function AddBrandDialog({ brand, onClose }: AddBrandDialogProps) {
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
            toast.error("Brand must be at least one type")
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
                toast.success("Brand updated")
            } else {
                await createMutation.mutateAsync({
                    name,
                    isVehicleMake,
                    isPartManufacturer,
                    logoUrl: logoUrl || undefined
                })
                toast.success("Brand created")
            }
            handleClose(false)
        } catch (error: any) {
            toast.error(error.message || "Failed to save brand")
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            {!brand && (
                <DialogTrigger asChild>
                    <Button size="sm">
                        <Plus className="mr-2 h-4 w-4" /> Brand
                    </Button>
                </DialogTrigger>
            )}
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>{brand ? "Edit Brand" : "Add Brand"}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Name</Label>
                            <Input id="name" name="name" defaultValue={brand?.name} placeholder="e.g., Volkswagen, Bosch" required />
                        </div>
                        <div className="space-y-4">
                            <Label>Brand Types</Label>
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center space-x-2">
                                    <Checkbox id="isVehicleMake" name="isVehicleMake" defaultChecked={brand?.isVehicleMake} />
                                    <Label htmlFor="isVehicleMake" className="font-normal">Vehicle Make (OEM)</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Checkbox id="isPartManufacturer" name="isPartManufacturer" defaultChecked={brand?.isPartManufacturer} />
                                    <Label htmlFor="isPartManufacturer" className="font-normal">Part Manufacturer (Aftermarket)</Label>
                                </div>
                            </div>
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="logoUrl">Logo URL (optional)</Label>
                            <Input id="logoUrl" name="logoUrl" defaultValue={brand?.logoUrl} placeholder="https://..." />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                        <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                            {brand ? "Save Changes" : "Create Brand"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Trash2, Edit2 } from "lucide-react"
import type { Brand } from "@/api/types"
import { useDeleteBrand } from "@/api/brands"
import { toast } from "sonner"

interface BrandTableProps {
    brands: Brand[]
    onEdit: (brand: Brand) => void
}

export function BrandTable({ brands, onEdit }: BrandTableProps) {
    const deleteMutation = useDeleteBrand()

    const handleDelete = async (id: number) => {
        if (!confirm("Are you sure you want to delete this brand?")) return
        try {
            await deleteMutation.mutateAsync(id)
            toast.success("Brand deleted")
        } catch (error: any) {
            toast.error(error.message || "Failed to delete brand")
        }
    }

    return (
        <div className="border rounded-md">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-[80px]">Logo</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {brands.map((brand) => (
                        <TableRow key={brand.id}>
                            <TableCell>
                                {brand.logoUrl ? (
                                    <img src={brand.logoUrl} alt={brand.name} className="w-8 h-8 object-contain rounded border bg-white" />
                                ) : (
                                    <div className="w-8 h-8 rounded border bg-slate-50 flex items-center justify-center text-[10px] text-slate-400 font-bold uppercase">
                                        {brand.name.substring(0, 2)}
                                    </div>
                                )}
                            </TableCell>
                            <TableCell className="font-medium">{brand.name}</TableCell>
                            <TableCell>
                                <Badge variant={brand.type === 'VEHICLE_MAKE' ? 'default' : 'secondary'}>
                                    {brand.type === 'VEHICLE_MAKE' ? 'Vehicle Make' : 'Part Manufacturer'}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex justify-end gap-2">
                                    <Button variant="ghost" size="icon" onClick={() => onEdit(brand)}>
                                        <Edit2 className="h-4 w-4" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(brand.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    )
}

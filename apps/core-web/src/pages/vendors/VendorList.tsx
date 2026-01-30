import { useState } from 'react'
import { useVendors } from '@/api/vendors'
import { Button } from '@/components/ui/button'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
import { VendorDialog } from './VendorDialog'
import { Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

export default function VendorList() {
    const { data: vendors, isLoading, error } = useVendors()
    const [isDialogOpen, setIsDialogOpen] = useState(false)

    if (isLoading) return <div>Loading vendors...</div>
    if (error) return <div>Error loading vendors</div>

    return (
        <div className="p-8 space-y-4">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Vendors</h1>
                <Button onClick={() => setIsDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Add Vendor
                </Button>
            </div>

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Account #</TableHead>
                            <TableHead>Supported Brands</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {vendors?.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center">
                                    No vendors found.
                                </TableCell>
                            </TableRow>
                        ) : (
                            vendors?.map((vendor) => (
                                <TableRow key={vendor.id}>
                                    <TableCell className="font-medium">{vendor.name}</TableCell>
                                    <TableCell>{vendor.email}</TableCell>
                                    <TableCell>{vendor.account_number}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {vendor.supportedBrands.map(brand => (
                                                <Badge key={brand.id} variant="outline">
                                                    {brand.name}
                                                </Badge>
                                            ))}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

            <VendorDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} />
        </div>
    )
}
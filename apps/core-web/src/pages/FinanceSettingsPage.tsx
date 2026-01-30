import * as React from "react"
import { format } from "date-fns"
import { Loader2, Save, AlertTriangle } from "lucide-react"
import { toast } from "sonner"

import { useFinanceSettings, useUpdateFinanceSettings, useRevenueGroups } from "@/api/useFinance"
import { useBrands } from "@/api/brands"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { 
    AlertDialog, 
    AlertDialogAction, 
    AlertDialogCancel, 
    AlertDialogContent, 
    AlertDialogDescription, 
    AlertDialogFooter, 
    AlertDialogHeader, 
    AlertDialogTitle 
} from "@/components/ui/alert-dialog"
import { RevenueGroupTable } from "@/components/RevenueGroupTable"
import { AddRevenueGroupDialog } from "@/components/AddRevenueGroupDialog"
import { BrandTable } from "@/components/BrandTable"
import { AddBrandDialog } from "@/components/AddBrandDialog"
import type { Brand } from "@/api/types"

export default function FinanceSettingsPage() {
    const { data: settings, isLoading } = useFinanceSettings()
    const { data: groups, isLoading: isLoadingGroups } = useRevenueGroups()
    const { data: brands, isLoading: isLoadingBrands } = useBrands()
    const updateMutation = useUpdateFinanceSettings()

    const [formState, setFormState] = React.useState({
        lock_date: "",
        invoice_prefix: "",
        next_invoice_number: 0
    })
    const [isAlertOpen, setIsAlertOpen] = React.useState(false)
    const [editingBrand, setEditingBrand] = React.useState<Brand | null>(null)

    React.useEffect(() => {
        if (settings) {
            setFormState({
                lock_date: settings.lock_date ? format(new Date(settings.lock_date), 'yyyy-MM-dd') : "",
                invoice_prefix: settings.invoice_prefix,
                next_invoice_number: settings.next_invoice_number
            })
        }
    }, [settings])

    const handleSaveRequest = (e: React.FormEvent) => {
        e.preventDefault()
        // Check if lock date is changed to a later date
        if (settings?.lock_date && formState.lock_date && new Date(formState.lock_date) > new Date(settings.lock_date)) {
            setIsAlertOpen(true)
        } else {
            handleSave()
        }
    }

    const handleSave = async () => {
        try {
            await updateMutation.mutateAsync({
                lock_date: formState.lock_date || null,
                invoice_prefix: formState.invoice_prefix,
                next_invoice_number: formState.next_invoice_number
            } as any)
            toast.success("Settings updated")
            setIsAlertOpen(false)
        } catch (error) {
            toast.error("Failed to update settings")
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="container mx-auto py-8">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-3xl font-bold tracking-tight">Finance Settings</h1>
            </div>

            <Tabs defaultValue="general" className="space-y-6">
                <TabsList className="grid w-full grid-cols-3 max-w-[600px]">
                    <TabsTrigger value="general">General</TabsTrigger>
                    <TabsTrigger value="revenue-groups">Revenue Groups</TabsTrigger>
                    <TabsTrigger value="brands">Brands</TabsTrigger>
                </TabsList>

                <TabsContent value="general" className="space-y-6">
                    <form onSubmit={handleSaveRequest} className="space-y-8">
                        <div className="grid gap-6 p-6 bg-white border rounded-lg shadow-sm">
                            <div className="space-y-4">
                                <h3 className="text-lg font-medium">Fiscal Control</h3>
                                <div className="grid gap-2 max-w-sm">
                                    <Label htmlFor="lock_date">Lock Date</Label>
                                    <Input 
                                        id="lock_date" 
                                        type="date" 
                                        value={formState.lock_date} 
                                        onChange={e => setFormState(prev => ({ ...prev, lock_date: e.target.value }))}
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        Transactions on or before this date cannot be modified.
                                    </p>
                                </div>
                            </div>

                            <hr />

                            <div className="space-y-4">
                                <h3 className="text-lg font-medium">Invoice Numbering</h3>
                                <div className="grid grid-cols-2 gap-4 max-w-md">
                                    <div className="grid gap-2">
                                        <Label htmlFor="prefix">Prefix</Label>
                                        <Input 
                                            id="prefix" 
                                            value={formState.invoice_prefix} 
                                            onChange={e => setFormState(prev => ({ ...prev, invoice_prefix: e.target.value }))}
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="next_number">Next Number</Label>
                                        <Input 
                                            id="next_number" 
                                            type="number"
                                            value={formState.next_invoice_number} 
                                            onChange={e => setFormState(prev => ({ ...prev, next_invoice_number: parseInt(e.target.value) || 0 }))}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end">
                            <Button type="submit" disabled={updateMutation.isPending}>
                                {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Save Changes
                            </Button>
                        </div>
                    </form>
                </TabsContent>

                <TabsContent value="revenue-groups" className="space-y-6">
                    <div className="p-6 bg-white border rounded-lg shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-lg font-medium">Revenue Groups</h3>
                                <p className="text-sm text-muted-foreground">
                                    Categorize your revenue for accounting and tax reporting.
                                </p>
                            </div>
                            <AddRevenueGroupDialog />
                        </div>
                        {isLoadingGroups ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <RevenueGroupTable groups={groups || []} />
                        )}
                    </div>
                </TabsContent>

                <TabsContent value="brands" className="space-y-6">
                    <div className="p-6 bg-white border rounded-lg shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-lg font-medium">Brands</h3>
                                <p className="text-sm text-muted-foreground">
                                    Centralized vehicle makes and part manufacturers.
                                </p>
                            </div>
                            <AddBrandDialog brand={editingBrand} onClose={() => setEditingBrand(null)} />
                        </div>
                        {isLoadingBrands ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        ) : (
                            <BrandTable brands={brands || []} onEdit={setEditingBrand} />
                        )}
                    </div>
                </TabsContent>
            </Tabs>

            <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" />
                            Confirm Fiscal Lock
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Changing the lock date to a later date will permanently prevent modifications to all transactions in the previous period. This may affect finalized reports. Are you sure?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleSave} className="bg-amber-600 hover:bg-amber-700">
                            Confirm Lock
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

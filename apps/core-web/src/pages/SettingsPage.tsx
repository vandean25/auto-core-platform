import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { format } from "date-fns"
import { Loader2, Save, AlertTriangle } from "lucide-react"
import { toast } from "sonner"

import { useAuthSession } from "@/api/auth-session"
import { useFinanceSettings, useUpdateFinanceSettings, useRevenueGroups } from "@/api/useFinance"
import { useBrands } from "@/api/brands"
import { useLocationTree, useCreateLocation, useDeleteLocation, type StorageLocation, type LocationType } from "@/api/locations"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { LaborCategoriesTab } from "@/components/labor/LaborCategoriesTab"
import { PageLoader } from "@/components/ui/PageLoader"
import { EmployeeSettingsTab } from "@/components/settings/EmployeeSettingsTab"
import { BaySettingsTab } from "@/components/settings/BaySettingsTab"
import { TeamSettingsTab } from "@/components/settings/TeamSettingsTab"
import { VoiceTranslationSettingsTab } from "@/components/settings/VoiceTranslationSettingsTab"
import { cn } from "@/lib/utils"
import { getErrorMessage } from "@/lib/error-utils"
import type { Brand } from "@/api/types"
import { Folder, ChevronRight, ChevronDown, Box, Trash2 } from "lucide-react"

// ─── Location Tree Item (reused from former LocationManagement) ────────────
const LocationTreeItem = ({
    location,
    level = 0,
    onDelete
}: {
    location: StorageLocation;
    level?: number;
    onDelete: (id: string) => void;
}) => {
    const [expanded, setExpanded] = React.useState(true)
    const hasChildren = location.children && location.children.length > 0

    return (
        <div className="select-none">
            <div
                className={cn(
                    "flex items-center gap-2 p-2 hover:bg-slate-100 rounded-md cursor-pointer group",
                    level > 0 && "ml-4 border-l-2 border-slate-200"
                )}
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-1 text-slate-500 w-4">
                    {hasChildren && (
                        expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                    )}
                </div>

                {location.type === 'warehouse' ? <Folder className="h-4 w-4 text-blue-500" /> :
                    location.type === 'bin' ? <Box className="h-4 w-4 text-green-500" /> :
                        <div className="h-2 w-2 rounded-full bg-slate-400 mx-1" />}

                <span className="font-medium text-sm">{location.name}</span>
                <Badge variant="outline" className="text-xs h-5 ml-2 font-mono text-slate-400 group-hover:text-slate-600 transition-colors">
                    {location.code}
                </Badge>

                <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(`Delete ${location.name}?`)) {
                                onDelete(location.id)
                            }
                        }}
                    >
                        <Trash2 className="h-3 w-3" />
                    </Button>
                </div>
            </div>

            {expanded && hasChildren && (
                <div className="ml-2">
                    {location.children!.map(child => (
                        <LocationTreeItem key={child.id} location={child} level={level + 1} onDelete={onDelete} />
                    ))}
                </div>
            )}
        </div>
    )
}

// ─── Storage Locations Tab Content ─────────────────────────────────────────
function StorageLocationsTab() {
    const { data: tree, isLoading, refetch } = useLocationTree()
    const createMutation = useCreateLocation()
    const deleteMutation = useDeleteLocation()

    const [newItem, setNewItem] = React.useState({
        name: '',
        code: '',
        type: 'warehouse' as LocationType,
        parentId: ''
    })

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault()
        try {
            await createMutation.mutateAsync({
                name: newItem.name,
                code: newItem.code,
                type: newItem.type,
                parentId: newItem.parentId || undefined
            })
            toast.success('Location created successfully')
            setNewItem({ name: '', code: '', type: 'warehouse', parentId: '' })
            refetch()
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, 'Failed to create location'))
        }
    }

    const handleDelete = async (id: string) => {
        try {
            await deleteMutation.mutateAsync(id)
            toast.success('Location deleted')
            refetch()
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, 'Failed to delete location'))
        }
    }

    const flatten = (nodes: StorageLocation[], result: StorageLocation[] = []) => {
        nodes.forEach(node => {
            result.push(node)
            if (node.children) flatten(node.children, result)
        })
        return result
    }
    const flatLocations = tree ? flatten(tree) : []

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-4">
                <div>
                    <h3 className="text-lg font-medium">Storage Locations</h3>
                    <p className="text-sm text-muted-foreground">Manage hierarchical bin locations for your warehouse.</p>
                </div>

                <Card>
                    <CardContent className="p-4">
                        {isLoading ? (
                            <div className="flex items-center justify-center p-8 text-slate-500">
                                <Loader2 className="animate-spin h-6 w-6 mr-2" /> Loading hierarchy...
                            </div>
                        ) : tree?.length === 0 ? (
                            <div className="text-center p-8 text-slate-500">
                                No locations found. Create your first warehouse.
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {tree?.map(loc => (
                                    <LocationTreeItem key={loc.id} location={loc} onDelete={handleDelete} />
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div>
                <Card>
                    <CardHeader>
                        <CardTitle>Add Location</CardTitle>
                        <CardDescription>Create a new storage unit.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Name</label>
                                <Input
                                    value={newItem.name}
                                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                    placeholder="e.g. Main Warehouse"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Code (Unique)</label>
                                <Input
                                    value={newItem.code}
                                    onChange={e => setNewItem({ ...newItem, code: e.target.value })}
                                    placeholder="e.g. WH-001"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Type</label>
                                <Select
                                    value={newItem.type}
                                    onValueChange={(val: LocationType) => setNewItem({ ...newItem, type: val })}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="warehouse">Warehouse</SelectItem>
                                        <SelectItem value="aisle">Aisle</SelectItem>
                                        <SelectItem value="shelf">Shelf</SelectItem>
                                        <SelectItem value="bin">Bin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm font-medium">Parent Location</label>
                                <Select
                                    value={newItem.parentId}
                                    onValueChange={(val) => setNewItem({ ...newItem, parentId: val === 'none' ? '' : val })}
                                    disabled={newItem.type === 'warehouse'}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder={newItem.type === 'warehouse' ? "None (Root)" : "Select Parent"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None (Root)</SelectItem>
                                        {flatLocations.map(loc => (
                                            <SelectItem key={loc.id} value={loc.id}>
                                                {loc.name} ({loc.type})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                                {createMutation.isPending && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
                                Create Location
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

// ─── Main Settings Page ────────────────────────────────────────────────────
const VALID_TABS = ["finance", "voice-translation", "revenue-groups", "brands", "locations", "employees", "bays", "labor", "team"] as const
type SettingsTab = typeof VALID_TABS[number]

export default function SettingsPage() {
    const sessionQuery = useAuthSession()
    const [searchParams, setSearchParams] = useSearchParams()
    const rawTab = searchParams.get("tab")
    const canManageTeam = sessionQuery.data?.activeRole === 'ADMIN' || sessionQuery.data?.activeRole === 'OWNER'
    const requestedTab = VALID_TABS.includes(rawTab as SettingsTab) ? (rawTab as SettingsTab) : "finance"
    const activeTab: SettingsTab = requestedTab === 'team' && !canManageTeam ? 'finance' : requestedTab

    // ── Finance state ──
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
            })
            toast.success("Settings updated")
            setIsAlertOpen(false)
        } catch (error) {
            toast.error("Failed to update settings")
        }
    }

    const handleTabChange = (value: string) => {
        setSearchParams({ tab: value })
    }

    if (sessionQuery.isLoading) {
        return <PageLoader />
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="w-full max-w-7xl mx-auto p-6 space-y-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
                    <p className="text-slate-500">Manage your platform configuration, master data, and storage locations.</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
                <TabsList className={cn("grid w-full max-w-[1300px]", canManageTeam ? 'grid-cols-9' : 'grid-cols-8')}>
                    <TabsTrigger value="finance">Finance</TabsTrigger>
                    <TabsTrigger value="voice-translation">Voice Translation</TabsTrigger>
                    <TabsTrigger value="revenue-groups">Revenue Groups</TabsTrigger>
                    <TabsTrigger value="brands">Brands</TabsTrigger>
                    <TabsTrigger value="locations">Storage Locations</TabsTrigger>
                    <TabsTrigger value="employees">Employees</TabsTrigger>
                    <TabsTrigger value="bays">Bays</TabsTrigger>
                    <TabsTrigger value="labor">Labor</TabsTrigger>
                    {canManageTeam ? <TabsTrigger value="team">Team</TabsTrigger> : null}
                </TabsList>

                {/* ── Finance Tab ── */}
                <TabsContent value="finance" className="space-y-6">
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

                <TabsContent value="voice-translation" className="space-y-6">
                    <VoiceTranslationSettingsTab />
                </TabsContent>

                {/* ── Revenue Groups Tab ── */}
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

                {/* ── Brands Tab ── */}
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

                {/* ── Storage Locations Tab ── */}
                <TabsContent value="locations" className="space-y-6">
                    <StorageLocationsTab />
                </TabsContent>

                {/* ── Employees Tab ── */}
                <TabsContent value="employees" className="space-y-6">
                    <EmployeeSettingsTab />
                </TabsContent>

                {/* ── Bays Tab ── */}
                <TabsContent value="bays" className="space-y-6">
                    <BaySettingsTab />
                </TabsContent>

                {/* ── Labor Tab ── */}
                <TabsContent value="labor" className="space-y-6">
                    <LaborCategoriesTab />
                </TabsContent>

                {/* ── Team Tab ── */}
                {canManageTeam ? (
                    <TabsContent value="team" className="space-y-6">
                        <TeamSettingsTab />
                    </TabsContent>
                ) : null}
            </Tabs>

            {/* Lock Date Alert Dialog */}
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

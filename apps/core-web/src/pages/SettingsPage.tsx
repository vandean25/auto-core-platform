import * as React from "react"
import { useTranslation } from "react-i18next"
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
import { WorkshopHoursSettingsTab } from "@/components/settings/WorkshopHoursSettingsTab"
import { TeamSettingsTab } from "@/components/settings/TeamSettingsTab"
import { ApiKeysSettingsTab } from "@/components/settings/ApiKeysSettingsTab"
import { VoiceTranslationSettingsTab } from "@/components/settings/VoiceTranslationSettingsTab"
import { AuditLogsTab } from "@/components/settings/AuditLogsTab"
import { AccountingExportSettingsTab } from "@/components/settings/AccountingExportSettingsTab"
import { LegalEntitiesSettingsTab } from "@/components/settings/LegalEntitiesSettingsTab"
import { SitesSettingsTab } from "@/components/settings/SitesSettingsTab"
import { VehicleDataSettingsTab } from "@/components/settings/VehicleDataSettingsTab"
import { MarginRulesTab } from "@/components/settings/MarginRulesTab"
import { DataImportSettingsTab } from "@/components/settings/data-import/DataImportSettingsTab"
import { cn } from "@/lib/utils"
import { getErrorMessage } from "@/lib/error-utils"
import { ensureNamespaceLoaded } from "@/lib/i18n"
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
    const { t } = useTranslation(['settings', 'common'])
    const [expanded, setExpanded] = React.useState(true)
    const hasChildren = location.children && location.children.length > 0

    return (
        <div className="select-none">
            <div
                className={cn(
                    "flex items-center gap-2 p-2 hover:bg-slate-100 rounded-md group",
                    level > 0 && "ml-4 border-l-2 border-slate-200"
                )}
            >
                <button
                    type="button"
                    className="flex flex-1 items-center gap-2 text-left"
                    onClick={() => setExpanded(!expanded)}
                    aria-expanded={hasChildren ? expanded : undefined}
                >
                    <span className="flex items-center gap-1 text-slate-500 w-4">
                        {hasChildren && (
                            expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                        )}
                    </span>

                    {location.type === 'warehouse' ? <Folder className="h-4 w-4 text-blue-500" /> :
                        location.type === 'bin' ? <Box className="h-4 w-4 text-green-500" /> :
                            <span className="h-2 w-2 rounded-full bg-slate-400 mx-1" />}

                    <span className="font-medium text-sm">{location.name}</span>
                    <Badge variant="outline" className="text-xs h-5 ml-2 font-mono text-slate-500 group-hover:text-slate-600 transition-colors">
                        {location.code}
                    </Badge>
                </button>

                <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                        aria-label={t('storageLocations.deleteAria', { name: location.name, code: location.code })}
                        onClick={(e) => {
                            e.stopPropagation()
                            if (confirm(t('storageLocations.deleteConfirm', { name: location.name }))) {
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
    const { t } = useTranslation(['settings', 'common'])
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
            toast.success(t('storageLocations.toast.created'))
            setNewItem({ name: '', code: '', type: 'warehouse', parentId: '' })
            refetch()
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, t('storageLocations.toast.createFailed')))
        }
    }

    const handleDelete = async (id: string) => {
        try {
            await deleteMutation.mutateAsync(id)
            toast.success(t('storageLocations.toast.deleted'))
            refetch()
        } catch (error: unknown) {
            toast.error(getErrorMessage(error, t('storageLocations.toast.deleteFailed')))
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
                    <h2 className="text-lg font-medium">{t('storageLocations.title')}</h2>
                    <p className="text-sm text-muted-foreground">{t('storageLocations.description')}</p>
                </div>

                <Card>
                    <CardContent className="p-4">
                        {isLoading ? (
                            <div className="flex items-center justify-center p-8 text-slate-500">
                                <Loader2 className="animate-spin h-6 w-6 mr-2" /> {t('storageLocations.loading')}
                            </div>
                        ) : tree?.length === 0 ? (
                            <div className="text-center p-8 text-slate-500">
                                {t('storageLocations.empty')}
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
                        <CardTitle as="h3">{t('storageLocations.add.title')}</CardTitle>
                        <CardDescription>{t('storageLocations.add.description')}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleCreate} className="space-y-4">
                            <div className="space-y-2">
                                <label htmlFor="location-name" className="text-sm font-medium">{t('storageLocations.form.name')}</label>
                                <Input
                                    id="location-name"
                                    value={newItem.name}
                                    onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                                    placeholder={t('storageLocations.form.namePlaceholder')}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="location-code" className="text-sm font-medium">{t('storageLocations.form.code')}</label>
                                <Input
                                    id="location-code"
                                    value={newItem.code}
                                    onChange={e => setNewItem({ ...newItem, code: e.target.value })}
                                    placeholder={t('storageLocations.form.codePlaceholder')}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="location-type" className="text-sm font-medium">{t('storageLocations.form.type')}</label>
                                <Select
                                    value={newItem.type}
                                    onValueChange={(val: LocationType) => setNewItem({ ...newItem, type: val })}
                                >
                                    <SelectTrigger id="location-type">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="warehouse">{t('storageLocations.types.warehouse')}</SelectItem>
                                        <SelectItem value="aisle">{t('storageLocations.types.aisle')}</SelectItem>
                                        <SelectItem value="shelf">{t('storageLocations.types.shelf')}</SelectItem>
                                        <SelectItem value="bin">{t('storageLocations.types.bin')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="location-parent" className="text-sm font-medium">{t('storageLocations.form.parent')}</label>
                                <Select
                                    value={newItem.parentId}
                                    onValueChange={(val) => setNewItem({ ...newItem, parentId: val === 'none' ? '' : val })}
                                    disabled={newItem.type === 'warehouse'}
                                >
                                    <SelectTrigger id="location-parent">
                                        <SelectValue placeholder={newItem.type === 'warehouse' ? t('storageLocations.form.parentNone') : t('storageLocations.form.parentSelect')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">{t('storageLocations.form.parentNone')}</SelectItem>
                                        {flatLocations.map(loc => (
                                            <SelectItem key={loc.id} value={loc.id}>
                                                {loc.name} ({t(`storageLocations.types.${loc.type}`)})
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                                {createMutation.isPending && <Loader2 className="animate-spin mr-2 h-4 w-4" />}
                                {t('storageLocations.form.submit')}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

// ─── Main Settings Page ────────────────────────────────────────────────────
const VALID_TABS = ["finance", "voice-translation", "revenue-groups", "brands", "legal-entities", "sites", "locations", "employees", "bays", "hours", "labor", "vehicle-data", "margin-rules", "data-import", "team", "api-keys", "audit-logs"] as const
type SettingsTab = typeof VALID_TABS[number]

export default function SettingsPage() {
    const { t } = useTranslation(['settings', 'common'])
    React.useEffect(() => {
        void ensureNamespaceLoaded('settings')
    }, [])
    const sessionQuery = useAuthSession()
    const [searchParams, setSearchParams] = useSearchParams()
    const rawTab = searchParams.get("tab")
    const canManageTeam = sessionQuery.data?.activeRole === 'ADMIN' || sessionQuery.data?.activeRole === 'OWNER'
    const canManageVehicleData = canManageTeam
    const requestedTab = VALID_TABS.includes(rawTab as SettingsTab) ? (rawTab as SettingsTab) : "finance"
    const activeTab: SettingsTab =
        requestedTab === 'team' && !canManageTeam ? 'finance'
        : requestedTab === 'api-keys' && !canManageTeam ? 'finance'
        : requestedTab === 'vehicle-data' && !canManageVehicleData ? 'finance'
        : requestedTab === 'margin-rules' && !canManageTeam ? 'finance'
        : requestedTab === 'data-import' && !canManageTeam ? 'finance'
        : (requestedTab === 'legal-entities' || requestedTab === 'sites') && !canManageTeam ? 'finance'
        : requestedTab

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
            toast.success(t('finance.toast.updated'))
            setIsAlertOpen(false)
        } catch (error) {
            toast.error(t('finance.toast.updateFailed'))
        }
    }

    const handleTabChange = (value: string) => {
        setSearchParams({ tab: value })
    }

    if (sessionQuery.isLoading) {
        return <PageLoader />
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{t('page.title')}</h1>
                    <p className="text-slate-500">{t('page.description')}</p>
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center min-h-[400px]">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            ) : (
            <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
                <TabsList className="flex h-auto w-full max-w-[1300px] justify-start gap-1 overflow-x-auto">
                    <TabsTrigger className="shrink-0" value="finance">{t('tabs.finance')}</TabsTrigger>
                    <TabsTrigger className="shrink-0" value="voice-translation">{t('tabs.voiceTranslation')}</TabsTrigger>
                    <TabsTrigger className="shrink-0" value="revenue-groups">{t('tabs.revenueGroups')}</TabsTrigger>
                    <TabsTrigger className="shrink-0" value="brands">{t('tabs.brands')}</TabsTrigger>
                    {canManageTeam ? <TabsTrigger className="shrink-0" value="legal-entities">{t('tabs.legalEntities')}</TabsTrigger> : null}
                    {canManageTeam ? <TabsTrigger className="shrink-0" value="sites">{t('tabs.sites')}</TabsTrigger> : null}
                    <TabsTrigger className="shrink-0" value="locations">{t('tabs.locations')}</TabsTrigger>
                    <TabsTrigger className="shrink-0" value="employees">{t('tabs.employees')}</TabsTrigger>
                    <TabsTrigger className="shrink-0" value="bays">{t('tabs.bays')}</TabsTrigger>
                    <TabsTrigger className="shrink-0" value="hours">{t('tabs.hours')}</TabsTrigger>
                    <TabsTrigger className="shrink-0" value="labor">{t('tabs.labor')}</TabsTrigger>
                    {canManageVehicleData ? <TabsTrigger className="shrink-0" value="vehicle-data">{t('tabs.vehicleData')}</TabsTrigger> : null}
                    {canManageTeam ? <TabsTrigger className="shrink-0" value="margin-rules">{t('tabs.marginRules')}</TabsTrigger> : null}
                    {canManageTeam ? <TabsTrigger className="shrink-0" value="data-import">{t('tabs.dataImport')}</TabsTrigger> : null}
                    {canManageTeam ? <TabsTrigger className="shrink-0" value="team">{t('tabs.team')}</TabsTrigger> : null}
                    {canManageTeam ? <TabsTrigger className="shrink-0" value="api-keys">{t('tabs.apiKeys')}</TabsTrigger> : null}
                    <TabsTrigger className="shrink-0" value="audit-logs">{t('tabs.auditLogs')}</TabsTrigger>
                </TabsList>

                {/* ── Finance Tab ── */}
                <TabsContent value="finance" className="space-y-6">
                    <Tabs defaultValue="fiscal" className="space-y-6">
                        <TabsList>
                            <TabsTrigger value="fiscal">{t('finance.subTabs.fiscal')}</TabsTrigger>
                            {canManageTeam ? (
                                <TabsTrigger value="accounting-export">{t('finance.subTabs.accountingExport')}</TabsTrigger>
                            ) : null}
                        </TabsList>
                        <TabsContent value="fiscal" className="space-y-6">
                    <form onSubmit={handleSaveRequest} className="space-y-8">
                        <div className="grid gap-6 p-6 bg-white border rounded-lg shadow-sm">
                            <div className="space-y-4">
                                <h2 className="text-lg font-medium">{t('finance.fiscal.title')}</h2>
                                <div className="grid gap-2 max-w-sm">
                                    <Label htmlFor="lock_date">{t('finance.fiscal.lockDate')}</Label>
                                    <Input
                                        id="lock_date"
                                        type="date"
                                        value={formState.lock_date}
                                        onChange={e => setFormState(prev => ({ ...prev, lock_date: e.target.value }))}
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        {t('finance.fiscal.lockDateHint')}
                                    </p>
                                </div>
                            </div>

                            <hr />

                            <div className="space-y-4">
                                <h2 className="text-lg font-medium">{t('finance.invoicing.title')}</h2>
                                <div className="grid grid-cols-2 gap-4 max-w-md">
                                    <div className="grid gap-2">
                                        <Label htmlFor="prefix">{t('finance.invoicing.prefix')}</Label>
                                        <Input
                                            id="prefix"
                                            value={formState.invoice_prefix}
                                            onChange={e => setFormState(prev => ({ ...prev, invoice_prefix: e.target.value }))}
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label htmlFor="next_number">{t('finance.invoicing.nextNumber')}</Label>
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
                                {t('finance.saveChanges')}
                            </Button>
                        </div>
                    </form>
                        </TabsContent>
                        {canManageTeam ? (
                            <TabsContent value="accounting-export" className="space-y-6">
                                <AccountingExportSettingsTab canManageExports={canManageTeam} />
                            </TabsContent>
                        ) : null}
                    </Tabs>
                </TabsContent>

                <TabsContent value="voice-translation" className="space-y-6">
                    <VoiceTranslationSettingsTab />
                </TabsContent>

                {/* ── Revenue Groups Tab ── */}
                <TabsContent value="revenue-groups" className="space-y-6">
                    <div className="p-6 bg-white border rounded-lg shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-lg font-medium">{t('revenueGroups.title')}</h2>
                                <p className="text-sm text-muted-foreground">
                                    {t('revenueGroups.description')}
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
                                <h2 className="text-lg font-medium">{t('brands.title')}</h2>
                                <p className="text-sm text-muted-foreground">
                                    {t('brands.description')}
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

                {canManageTeam ? (
                    <TabsContent value="legal-entities" className="space-y-6">
                        <LegalEntitiesSettingsTab />
                    </TabsContent>
                ) : null}

                {canManageTeam ? (
                    <TabsContent value="sites" className="space-y-6">
                        <SitesSettingsTab />
                    </TabsContent>
                ) : null}

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

                <TabsContent value="hours" className="space-y-6">
                    <WorkshopHoursSettingsTab />
                </TabsContent>

                {/* ── Labor Tab ── */}
                <TabsContent value="labor" className="space-y-6">
                    <LaborCategoriesTab />
                </TabsContent>

                {canManageVehicleData ? (
                    <TabsContent value="vehicle-data" className="space-y-6">
                        <VehicleDataSettingsTab />
                    </TabsContent>
                ) : null}

                {canManageTeam ? (
                    <TabsContent value="margin-rules" className="space-y-6">
                        <MarginRulesTab />
                    </TabsContent>
                ) : null}

                {canManageTeam ? (
                    <TabsContent value="data-import" className="space-y-6">
                        <DataImportSettingsTab />
                    </TabsContent>
                ) : null}

                {/* ── Team Tab ── */}
                {canManageTeam ? (
                    <TabsContent value="team" className="space-y-6">
                        <TeamSettingsTab />
                    </TabsContent>
                ) : null}

                {/* ── API Keys Tab (OWNER/ADMIN; ADR-0026) ── */}
                {canManageTeam ? (
                    <TabsContent value="api-keys" className="space-y-6">
                        <ApiKeysSettingsTab />
                    </TabsContent>
                ) : null}

                {/* ── Audit Logs Tab ── */}
                <TabsContent value="audit-logs" className="space-y-6">
                    <div className="p-6 bg-white border rounded-lg shadow-sm">
                        <AuditLogsTab />
                    </div>
                </TabsContent>
            </Tabs>
            )}

            {/* Lock Date Alert Dialog */}
            <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" />
                            {t('finance.lockDialog.title')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('finance.lockDialog.description')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={handleSave} className="bg-amber-600 hover:bg-amber-700">
                            {t('finance.lockDialog.confirm')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

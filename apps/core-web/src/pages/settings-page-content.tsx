import * as React from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useAuthSession } from "@/api/auth-session"
import { useRevenueGroups } from "@/api/useFinance"
import { useBrands } from "@/api/brands"
import { useLocationTree, useCreateLocation, useDeleteLocation, type StorageLocation, type LocationType } from "@/api/locations"
import { SettingsSectionHeading } from "@/components/settings/SettingsSectionHeading"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RevenueGroupTable } from "@/components/RevenueGroupTable"
import { AddRevenueGroupDialog } from "@/components/AddRevenueGroupDialog"
import { BrandTable } from "@/components/BrandTable"
import { AddBrandDialog } from "@/components/AddBrandDialog"
import { LaborCategoriesTab } from "@/components/labor/LaborCategoriesTab"
import { PageLoader } from "@/components/ui/PageLoader"
import { EmployeeSettingsTab } from "@/components/settings/EmployeeSettingsTab"
import { BaySettingsTab } from "@/components/settings/BaySettingsTab"
import { WorkshopHoursSettingsPanel } from "@/components/settings/workshop-hours-settings-panel"
import { TeamSettingsTab } from "@/components/settings/TeamSettingsTab"
import { ApiKeysSettingsTab } from "@/components/settings/ApiKeysSettingsTab"
import { VoiceTranslationSettingsTab } from "@/components/settings/VoiceTranslationSettingsTab"
import { AuditLogsTab } from "@/components/settings/AuditLogsTab"
import { LegalEntitiesSettingsTab } from "@/components/settings/LegalEntitiesSettingsTab"
import { SitesSettingsTab } from "@/components/settings/sites-settings-tab"
import { VehicleDataSettingsPanel } from "@/components/settings/vehicle-data-settings-panel"
import { MarginRulesTab } from "@/components/settings/MarginRulesTab"
import { DataImportSettingsTab } from "@/components/settings/data-import/DataImportSettingsTab"
import { cn } from "@/lib/utils"
import { getErrorMessage } from "@/lib/error-utils"
import { ensureNamespaceLoaded } from "@/lib/i18n"
import type { Brand, RevenueGroup } from "@/api/types"
import { Folder, ChevronRight, ChevronDown, Box, Trash2 } from "lucide-react"
import { FinanceSettingsTab, LockDateAlertDialog, useFinanceSettingsForm } from "./settings-finance-tab"
import { getVisibleTabs, type SettingsTab } from "./settings-page-tabs"

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

                <div className="ml-auto opacity-0 transition-opacity pointer-coarse:opacity-100 hover-capable:group-hover:opacity-100">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="min-h-11 min-w-11 text-red-500 hover:text-red-700 hover:bg-red-50"
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
                <SettingsSectionHeading
                    title={t('storageLocations.title')}
                    description={t('storageLocations.description')}
                />

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

// ─── Revenue Groups Tab ────────────────────────────────────────────────────
function RevenueGroupsTab({ groups, isLoading }: { groups: RevenueGroup[] | undefined; isLoading: boolean }) {
    const { t } = useTranslation(['settings', 'common'])

    return (
        <div className="p-6 bg-white border rounded-lg shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <SettingsSectionHeading
                    title={t('revenueGroups.title')}
                    description={t('revenueGroups.description')}
                />
                <AddRevenueGroupDialog />
            </div>
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <RevenueGroupTable groups={groups || []} />
            )}
        </div>
    )
}

// ─── Brands Tab ────────────────────────────────────────────────────────────
function BrandsTab({ brands, isLoading }: { brands: Brand[] | undefined; isLoading: boolean }) {
    const { t } = useTranslation(['settings', 'common'])
    const [editingBrand, setEditingBrand] = React.useState<Brand | null>(null)

    return (
        <div className="p-6 bg-white border rounded-lg shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <SettingsSectionHeading
                        title={t('brands.title')}
                        description={t('brands.description')}
                    />
                </div>
                <AddBrandDialog brand={editingBrand} onClose={() => setEditingBrand(null)} />
            </div>
            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <BrandTable brands={brands || []} onEdit={setEditingBrand} />
            )}
        </div>
    )
}

// ─── Main Settings Page ────────────────────────────────────────────────────
export default function SettingsPage() {
    const { t } = useTranslation(['settings', 'common'])
    React.useEffect(() => {
        void ensureNamespaceLoaded('settings')
    }, [])
    const sessionQuery = useAuthSession()
    const [searchParams, setSearchParams] = useSearchParams()
    const canManageTeam = sessionQuery.data?.activeRole === 'ADMIN' || sessionQuery.data?.activeRole === 'OWNER'
    const visibleTabs = getVisibleTabs(canManageTeam)
    const activeTab = visibleTabs.find(tab => tab === searchParams.get("tab")) ?? "finance"

    const finance = useFinanceSettingsForm()
    const { data: groups, isLoading: isLoadingGroups } = useRevenueGroups()
    const { data: brands, isLoading: isLoadingBrands } = useBrands()

    if (sessionQuery.isLoading) {
        return <PageLoader />
    }

    const tabLabels: Record<SettingsTab, string> = {
        "finance": t('tabs.finance'),
        "voice-translation": t('tabs.voiceTranslation'),
        "revenue-groups": t('tabs.revenueGroups'),
        "brands": t('tabs.brands'),
        "legal-entities": t('tabs.legalEntities'),
        "sites": t('tabs.sites'),
        "locations": t('tabs.locations'),
        "employees": t('tabs.employees'),
        "bays": t('tabs.bays'),
        "hours": t('tabs.hours'),
        "labor": t('tabs.labor'),
        "vehicle-data": t('tabs.vehicleData'),
        "margin-rules": t('tabs.marginRules'),
        "data-import": t('tabs.dataImport'),
        "team": t('tabs.team'),
        "api-keys": t('tabs.apiKeys'),
        "audit-logs": t('tabs.auditLogs')
    }

    const tabPanels: Record<SettingsTab, React.ReactNode> = {
        "finance": <FinanceSettingsTab form={finance} canManageExports={canManageTeam} />,
        "voice-translation": <VoiceTranslationSettingsTab />,
        "revenue-groups": <RevenueGroupsTab groups={groups} isLoading={isLoadingGroups} />,
        "brands": <BrandsTab brands={brands} isLoading={isLoadingBrands} />,
        "legal-entities": <LegalEntitiesSettingsTab />,
        "sites": <SitesSettingsTab />,
        "locations": <StorageLocationsTab />,
        "employees": <EmployeeSettingsTab />,
        "bays": <BaySettingsTab />,
        "hours": <WorkshopHoursSettingsPanel />,
        "labor": <LaborCategoriesTab />,
        "vehicle-data": <VehicleDataSettingsPanel />,
        "margin-rules": <MarginRulesTab />,
        "data-import": <DataImportSettingsTab />,
        "team": <TeamSettingsTab />,
        "api-keys": <ApiKeysSettingsTab />,
        "audit-logs": (
            <div className="p-6 bg-white border rounded-lg shadow-sm">
                <AuditLogsTab />
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight">{t('page.title')}</h1>
                    <p className="text-slate-500">{t('page.description')}</p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setSearchParams({ tab: value })} className="space-y-6">
                <TabsList className="flex h-auto w-full max-w-[1300px] justify-start gap-1 overflow-x-auto">
                    {visibleTabs.map(tab => (
                        <TabsTrigger key={tab} className="shrink-0" value={tab}>{tabLabels[tab]}</TabsTrigger>
                    ))}
                </TabsList>

                {visibleTabs.map(tab => (
                    <TabsContent key={tab} value={tab} className="space-y-6">
                        {tabPanels[tab]}
                    </TabsContent>
                ))}
            </Tabs>

            <LockDateAlertDialog form={finance} />
        </div>
    )
}

import * as React from "react"
import { useTranslation } from "react-i18next"
import { format } from "date-fns"
import { Loader2, Save, AlertTriangle } from "lucide-react"
import { toast } from "sonner"

import { useFinanceSettings, useUpdateFinanceSettings } from "@/api/useFinance"
import { SettingsSectionHeading } from "@/components/settings/SettingsSectionHeading"
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
import { AccountingExportSettingsPanel } from "@/components/settings/accounting-export-settings-panel"

// Finance form state lives in the page (not in the tab) so unsaved edits survive a tab switch.
export function useFinanceSettingsForm() {
    const { t } = useTranslation(['settings', 'common'])
    const { data: settings, isLoading } = useFinanceSettings()
    const updateMutation = useUpdateFinanceSettings()

    const [formState, setFormState] = React.useState({
        lock_date: "",
        invoice_prefix: "",
        next_invoice_number: 0
    })
    const [isAlertOpen, setIsAlertOpen] = React.useState(false)

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

    return {
        isLoading,
        formState,
        setFormState,
        isPending: updateMutation.isPending,
        isAlertOpen,
        setIsAlertOpen,
        handleSaveRequest,
        handleSave
    }
}

type FinanceSettingsForm = ReturnType<typeof useFinanceSettingsForm>

function FiscalSettingsForm({ form }: { form: FinanceSettingsForm }) {
    const { t } = useTranslation(['settings', 'common'])
    const { formState, setFormState } = form

    if (form.isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[200px]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <form onSubmit={form.handleSaveRequest} className="space-y-8">
            <div className="grid gap-6 p-6 bg-white border rounded-lg shadow-sm">
                <div className="space-y-4">
                    <SettingsSectionHeading title={t('finance.fiscal.title')} />
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
                    <SettingsSectionHeading title={t('finance.invoicing.title')} />
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
                <Button type="submit" disabled={form.isPending}>
                    {form.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {t('finance.saveChanges')}
                </Button>
            </div>
        </form>
    )
}

export function FinanceSettingsTab({ form, canManageExports }: { form: FinanceSettingsForm; canManageExports: boolean }) {
    const { t } = useTranslation(['settings', 'common'])

    return (
        <Tabs defaultValue="fiscal" className="space-y-6">
            <TabsList>
                <TabsTrigger value="fiscal">{t('finance.subTabs.fiscal')}</TabsTrigger>
                {canManageExports ? (
                    <TabsTrigger value="accounting-export">{t('finance.subTabs.accountingExport')}</TabsTrigger>
                ) : null}
            </TabsList>
            <TabsContent value="fiscal" className="space-y-6">
                <FiscalSettingsForm form={form} />
            </TabsContent>
            {canManageExports ? (
                <TabsContent value="accounting-export" className="space-y-6">
                    <AccountingExportSettingsPanel canManageExports={canManageExports} />
                </TabsContent>
            ) : null}
        </Tabs>
    )
}

export function LockDateAlertDialog({ form }: { form: FinanceSettingsForm }) {
    const { t } = useTranslation(['settings', 'common'])

    return (
        <AlertDialog open={form.isAlertOpen} onOpenChange={form.setIsAlertOpen}>
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
                    <AlertDialogAction onClick={form.handleSave} className="bg-amber-600 hover:bg-amber-700">
                        {t('finance.lockDialog.confirm')}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

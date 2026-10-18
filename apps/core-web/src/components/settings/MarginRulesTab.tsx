import * as React from 'react'
import { AlertCircle, ArrowDown, ArrowUp, Edit2, Loader2, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import type {
  CreateMarginRulePayload,
  MarginRoundingStrategy,
  MarginRule,
  UpdateMarginRulePayload,
} from '@/api/types'
import {
  useCreateMarginRule,
  useDeleteMarginRule,
  useMarginRules,
  usePriceJumpThreshold,
  useUpdateMarginRule,
  useUpdatePriceJumpThreshold,
} from '@/api/margin-rules'
import { useBrands } from '@/api/brands'
import { useRevenueGroups } from '@/api/useFinance'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getErrorMessage } from '@/lib/error-utils'
import { formatCurrency, formatPercent } from '@/lib/format'

const ROUNDING_STRATEGIES: readonly MarginRoundingStrategy[] = [
  'NONE',
  'ROUND_90',
  'ROUND_99',
  'WHOLE_EURO',
]

interface RuleFormData {
  name: string
  priority: number
  brand_id: number | null
  revenue_group_id: number | null
  cost_min: number | null
  cost_max: number | null
  markup_percent: number | null
  use_supplier_rrp: boolean
  rounding: MarginRoundingStrategy
  is_active: boolean
}

const DEFAULT_FORM_DATA: RuleFormData = {
  name: '',
  priority: 0,
  brand_id: null,
  revenue_group_id: null,
  cost_min: null,
  cost_max: null,
  markup_percent: null,
  use_supplier_rrp: false,
  rounding: 'NONE',
  is_active: true,
}

export function MarginRulesTab() {
  const { t } = useTranslation(['settings', 'common'])
  const { data: rules = [], isLoading: isLoadingRules } = useMarginRules()
  const { data: thresholdData } = usePriceJumpThreshold()
  const { data: brands = [] } = useBrands()
  const { data: revenueGroups = [] } = useRevenueGroups()

  const createRule = useCreateMarginRule()
  const updateRule = useUpdateMarginRule()
  const deleteRule = useDeleteMarginRule()
  const updateThreshold = useUpdatePriceJumpThreshold()

  const [thresholdInput, setThresholdInput] = React.useState<number>(20)
  const [prioritySortOrder, setPrioritySortOrder] = React.useState<'asc' | 'desc'>('asc')
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingRule, setEditingRule] = React.useState<MarginRule | null>(null)
  const [formData, setFormData] = React.useState<RuleFormData>(DEFAULT_FORM_DATA)
  const [deleteCandidate, setDeleteCandidate] = React.useState<MarginRule | null>(null)

  const sortedRules = React.useMemo(() => {
    return [...rules].sort((a, b) =>
      prioritySortOrder === 'asc' ? a.priority - b.priority : b.priority - a.priority,
    )
  }, [rules, prioritySortOrder])

  React.useEffect(() => {
    if (thresholdData?.price_jump_threshold_percent != null) {
      setThresholdInput(thresholdData.price_jump_threshold_percent)
    } else if (thresholdData?.threshold_percent != null) {
      setThresholdInput(thresholdData.threshold_percent)
    }
  }, [thresholdData])

  const openCreateDialog = () => {
    setEditingRule(null)
    setFormData(DEFAULT_FORM_DATA)
    setDialogOpen(true)
  }

  const openEditDialog = (rule: MarginRule) => {
    setEditingRule(rule)
    setFormData({
      name: rule.name,
      priority: rule.priority,
      brand_id: rule.brand_id ?? null,
      revenue_group_id: rule.revenue_group_id ?? null,
      cost_min: rule.cost_min != null ? Number(rule.cost_min) : null,
      cost_max: rule.cost_max != null ? Number(rule.cost_max) : null,
      markup_percent: rule.markup_percent != null ? Number(rule.markup_percent) : null,
      use_supplier_rrp: rule.use_supplier_rrp,
      rounding: rule.rounding,
      is_active: rule.is_active,
    })
    setDialogOpen(true)
  }

  const handleSaveThreshold = async () => {
    try {
      await updateThreshold.mutateAsync({
        threshold_percent: thresholdInput,
      })
      toast.success(t('marginRules.priceJump.toastUpdated'))
    } catch (error) {
      toast.error(getErrorMessage(error, t('marginRules.priceJump.toastSaveFailed')))
    }
  }

  const handleSubmitRule = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!formData.name.trim()) {
      toast.error(t('marginRules.toast.nameRequired'))
      return
    }

    if (
      formData.cost_min != null &&
      formData.cost_max != null &&
      formData.cost_min > formData.cost_max
    ) {
      toast.error(t('marginRules.toast.costRangeInvalid'))
      return
    }

    if (formData.markup_percent != null && formData.markup_percent < 0) {
      toast.error(t('marginRules.toast.markupNegative'))
      return
    }

    try {
      if (editingRule) {
        const payload: UpdateMarginRulePayload = {
          name: formData.name.trim(),
          priority: formData.priority,
          brand_id: formData.brand_id,
          revenue_group_id: formData.revenue_group_id,
          cost_min: formData.cost_min,
          cost_max: formData.cost_max,
          markup_percent: formData.markup_percent,
          use_supplier_rrp: formData.use_supplier_rrp,
          rounding: formData.rounding,
          is_active: formData.is_active,
        }
        await updateRule.mutateAsync({ id: editingRule.id, data: payload })
        toast.success(t('marginRules.toast.updated'))
      } else {
        const payload: CreateMarginRulePayload = {
          name: formData.name.trim(),
          priority: formData.priority,
          brand_id: formData.brand_id,
          revenue_group_id: formData.revenue_group_id,
          cost_min: formData.cost_min,
          cost_max: formData.cost_max,
          markup_percent: formData.markup_percent,
          use_supplier_rrp: formData.use_supplier_rrp,
          rounding: formData.rounding,
          is_active: formData.is_active,
        }
        await createRule.mutateAsync(payload)
        toast.success(t('marginRules.toast.created'))
      }
      setDialogOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error, t('marginRules.toast.saveFailed')))
    }
  }

  const handleDeleteRule = async () => {
    if (!deleteCandidate) return
    try {
      await deleteRule.mutateAsync(deleteCandidate.id)
      toast.success(t('marginRules.toast.deleted'))
      setDeleteCandidate(null)
    } catch (error) {
      toast.error(getErrorMessage(error, t('marginRules.toast.deleteFailed')))
    }
  }

  const formatCostRange = (min: number | null | undefined, max: number | null | undefined) => {
    const numMin = min != null ? Number(min) : null
    const numMax = max != null ? Number(max) : null

    if (numMin != null && numMax != null) {
      return t('marginRules.costRange.between', {
        min: formatCurrency(numMin),
        max: formatCurrency(numMax),
      })
    }
    if (numMin != null) {
      return t('marginRules.costRange.from', { amount: formatCurrency(numMin) })
    }
    if (numMax != null) {
      return t('marginRules.costRange.to', { amount: formatCurrency(numMax) })
    }
    return t('marginRules.costRange.all')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t('marginRules.title')}</h2>
          <p className="text-sm text-slate-500">
            {t('marginRules.description')}
          </p>
        </div>
        <Button onClick={openCreateDialog} className="self-start sm:self-auto">
          <Plus className="mr-2 h-4 w-4" />
          {t('marginRules.createButton')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle as="h3" className="text-base font-medium">{t('marginRules.priceJump.title')}</CardTitle>
          <CardDescription>
            {t('marginRules.priceJump.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end max-w-md">
            <div className="space-y-2 flex-1">
              <Label htmlFor="price-jump-threshold">{t('marginRules.priceJump.label')}</Label>
              <Input
                id="price-jump-threshold"
                type="number"
                min={0}
                max={1000}
                value={thresholdInput}
                onChange={(e) => setThresholdInput(Number(e.target.value) || 0)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={updateThreshold.isPending}
              onClick={handleSaveThreshold}
            >
              {updateThreshold.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('marginRules.priceJump.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h3" className="text-base font-medium">{t('marginRules.activeRules.title')}</CardTitle>
          <CardDescription>
            {t('marginRules.activeRules.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-medium hover:text-slate-900 transition-colors"
                      onClick={() =>
                        setPrioritySortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
                      }
                      aria-label={t('marginRules.columns.sortPriorityAria')}
                    >
                      <span>{t('marginRules.columns.priority')}</span>
                      {prioritySortOrder === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>{t('marginRules.columns.name')}</TableHead>
                  <TableHead>{t('marginRules.columns.brand')}</TableHead>
                  <TableHead>{t('marginRules.columns.revenueGroup')}</TableHead>
                  <TableHead>{t('marginRules.columns.costRange')}</TableHead>
                  <TableHead>{t('marginRules.columns.markup')}</TableHead>
                  <TableHead>{t('marginRules.columns.useRrp')}</TableHead>
                  <TableHead>{t('marginRules.columns.rounding')}</TableHead>
                  <TableHead>{t('marginRules.columns.status')}</TableHead>
                  <TableHead className="text-right">{t('marginRules.columns.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingRules ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                      {t('marginRules.loading')}
                    </TableCell>
                  </TableRow>
                ) : sortedRules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
                      {t('marginRules.empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedRules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-mono font-medium">{rule.priority}</TableCell>
                      <TableCell className="font-medium">{rule.name}</TableCell>
                      <TableCell>{rule.brand?.name || '—'}</TableCell>
                      <TableCell>{rule.revenue_group?.name || '—'}</TableCell>
                      <TableCell>{formatCostRange(rule.cost_min, rule.cost_max)}</TableCell>
                      <TableCell>{rule.markup_percent != null ? formatPercent(Number(rule.markup_percent), { maximumFractionDigits: 2 }) : '—'}</TableCell>
                      <TableCell>{rule.use_supplier_rrp ? t('marginRules.yes') : t('marginRules.no')}</TableCell>
                      <TableCell>{t(`marginRules.roundingShort.${rule.rounding}`, { defaultValue: rule.rounding })}</TableCell>
                      <TableCell>
                        <StatusBadge
                          status={rule.is_active ? 'ACTIVE' : 'INACTIVE'}
                          label={rule.is_active ? t('marginRules.status.active') : t('marginRules.status.inactive')}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(rule)}
                            aria-label={t('marginRules.editAria', { name: rule.name })}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteCandidate(rule)}
                            aria-label={t('marginRules.deleteAria', { name: rule.name })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingRule ? t('marginRules.dialog.editTitle') : t('marginRules.dialog.createTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('marginRules.dialog.description')}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitRule} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rule-name">{t('marginRules.form.name')}</Label>
              <Input
                id="rule-name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('marginRules.form.namePlaceholder')}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rule-priority">{t('marginRules.form.priority')}</Label>
                <Input
                  id="rule-priority"
                  type="number"
                  value={formData.priority}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, priority: Number(e.target.value) || 0 }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rule-markup">{t('marginRules.form.markup')}</Label>
                <Input
                  id="rule-markup"
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.markup_percent ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      markup_percent: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  placeholder={t('marginRules.form.markupPlaceholder')}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rule-brand">{t('marginRules.form.brand')}</Label>
                <Select
                  value={formData.brand_id ? String(formData.brand_id) : '__none__'}
                  onValueChange={(val) =>
                    setFormData((prev) => ({
                      ...prev,
                      brand_id: val === '__none__' ? null : Number(val),
                    }))
                  }
                >
                  <SelectTrigger id="rule-brand">
                    <SelectValue placeholder={t('marginRules.form.allBrands')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('marginRules.form.allBrands')}</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rule-revenue-group">{t('marginRules.form.revenueGroup')}</Label>
                <Select
                  value={
                    formData.revenue_group_id ? String(formData.revenue_group_id) : '__none__'
                  }
                  onValueChange={(val) =>
                    setFormData((prev) => ({
                      ...prev,
                      revenue_group_id: val === '__none__' ? null : Number(val),
                    }))
                  }
                >
                  <SelectTrigger id="rule-revenue-group">
                    <SelectValue placeholder={t('marginRules.form.allRevenueGroups')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('marginRules.form.allRevenueGroups')}</SelectItem>
                    {revenueGroups.map((rg) => (
                      <SelectItem key={rg.id} value={String(rg.id)}>
                        {rg.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rule-cost-min">{t('marginRules.form.costMin')}</Label>
                <Input
                  id="rule-cost-min"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.cost_min ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      cost_min: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="rule-cost-max">{t('marginRules.form.costMax')}</Label>
                <Input
                  id="rule-cost-max"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.cost_max ?? ''}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      cost_max: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  placeholder="100.00"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-rounding">{t('marginRules.form.rounding')}</Label>
              <Select
                value={formData.rounding}
                onValueChange={(val) =>
                  setFormData((prev) => ({
                    ...prev,
                    rounding: val as MarginRoundingStrategy,
                  }))
                }
              >
                <SelectTrigger id="rule-rounding">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROUNDING_STRATEGIES.map((strategy) => (
                    <SelectItem key={strategy} value={strategy}>
                      {t(`marginRules.rounding.${strategy}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="rule-use-rrp"
                  checked={formData.use_supplier_rrp}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, use_supplier_rrp: checked === true }))
                  }
                />
                <Label htmlFor="rule-use-rrp" className="font-normal cursor-pointer">
                  {t('marginRules.form.useSupplierRrp')}
                </Label>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="rule-active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) =>
                    setFormData((prev) => ({ ...prev, is_active: checked === true }))
                  }
                />
                <Label htmlFor="rule-active" className="font-normal cursor-pointer">
                  {t('marginRules.form.active')}
                </Label>
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {t('common:actions.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={createRule.isPending || updateRule.isPending}
              >
                {createRule.isPending || updateRule.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {editingRule ? t('marginRules.form.saveChanges') : t('marginRules.form.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Rule Confirmation */}
      <AlertDialog
        open={Boolean(deleteCandidate)}
        onOpenChange={(open) => !open && setDeleteCandidate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              {t('marginRules.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('marginRules.delete.description', { name: deleteCandidate?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteRule.isPending}
              onClick={(e) => {
                e.preventDefault()
                void handleDeleteRule()
              }}
            >
              {deleteRule.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('marginRules.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

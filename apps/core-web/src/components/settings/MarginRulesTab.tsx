import * as React from 'react'
import { AlertCircle, ArrowDown, ArrowUp, Edit2, Loader2, Plus, Trash2 } from 'lucide-react'
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
import { formatCurrency } from '@/lib/utils'

const ROUNDING_LABELS: Record<MarginRoundingStrategy, string> = {
  NONE: 'Keine Rundung',
  ROUND_90: 'Auf .90',
  ROUND_99: 'Auf .99',
  WHOLE_EURO: 'Voller Euro',
}

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
      toast.success('Schwellenwert für Preissprünge aktualisiert')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Fehler beim Speichern des Schwellenwerts'))
    }
  }

  const handleSubmitRule = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!formData.name.trim()) {
      toast.error('Bitte geben Sie eine Bezeichnung ein')
      return
    }

    if (
      formData.cost_min != null &&
      formData.cost_max != null &&
      formData.cost_min > formData.cost_max
    ) {
      toast.error('Mindest-Einkaufspreis darf nicht größer als Höchst-Einkaufspreis sein')
      return
    }

    if (formData.markup_percent != null && formData.markup_percent < 0) {
      toast.error('Aufschlag darf nicht negativ sein')
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
        toast.success('Margenregel aktualisiert')
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
        toast.success('Margenregel angelegt')
      }
      setDialogOpen(false)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Fehler beim Speichern der Margenregel'))
    }
  }

  const handleDeleteRule = async () => {
    if (!deleteCandidate) return
    try {
      await deleteRule.mutateAsync(deleteCandidate.id)
      toast.success('Margenregel gelöscht')
      setDeleteCandidate(null)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Fehler beim Löschen der Margenregel'))
    }
  }

  const formatCostRange = (min: number | null | undefined, max: number | null | undefined) => {
    const numMin = min != null ? Number(min) : null
    const numMax = max != null ? Number(max) : null

    if (numMin != null && numMax != null) {
      return `${formatCurrency(numMin)} – ${formatCurrency(numMax)}`
    }
    if (numMin != null) {
      return `ab ${formatCurrency(numMin)}`
    }
    if (numMax != null) {
      return `bis ${formatCurrency(numMax)}`
    }
    return 'Alle'
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Margenregeln</h2>
          <p className="text-sm text-slate-500">
            Regeln zur automatischen Berechnung von Verkaufspreisen basierend auf Einkaufspreisen, Marken und Erlösgruppen.
          </p>
        </div>
        <Button onClick={openCreateDialog} className="self-start sm:self-auto">
          <Plus className="mr-2 h-4 w-4" />
          + Margenregel
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Schwellenwert für Preissprünge</CardTitle>
          <CardDescription>
            Definiert den maximalen prozentualen Preissprung vor Warnung und Genehmigungserfordernis beim Preislistenimport.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end max-w-md">
            <div className="space-y-2 flex-1">
              <Label htmlFor="price-jump-threshold">Schwellenwert (%)</Label>
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
              Schwellenwert speichern
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">Aktive Regeln</CardTitle>
          <CardDescription>
            Regeln werden von oben nach unten (niedrigste Priorität zuerst) ausgewertet. Die erste passende Regel greift.
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
                      aria-label="Priorität sortieren"
                    >
                      <span>Prio</span>
                      {prioritySortOrder === 'asc' ? (
                        <ArrowUp className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead>Bezeichnung</TableHead>
                  <TableHead>Marke</TableHead>
                  <TableHead>Erlösgruppe</TableHead>
                  <TableHead>EK-Bereich</TableHead>
                  <TableHead>Aufschlag</TableHead>
                  <TableHead>UVP verwenden</TableHead>
                  <TableHead>Rundung</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingRules ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
                      Lade Margenregeln…
                    </TableCell>
                  </TableRow>
                ) : sortedRules.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-6 text-muted-foreground">
                      Keine Margenregeln definiert. Erstellen Sie eine neue Regel mit &quot;+ Margenregel&quot;.
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
                      <TableCell>{rule.markup_percent != null ? `${Number(rule.markup_percent)} %` : '—'}</TableCell>
                      <TableCell>{rule.use_supplier_rrp ? 'Ja' : 'Nein'}</TableCell>
                      <TableCell>{ROUNDING_LABELS[rule.rounding] || rule.rounding}</TableCell>
                      <TableCell>
                        <StatusBadge
                          status={rule.is_active ? 'ACTIVE' : 'INACTIVE'}
                          label={rule.is_active ? 'Aktiv' : 'Inaktiv'}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(rule)}
                            aria-label={`Bearbeiten ${rule.name}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeleteCandidate(rule)}
                            aria-label={`Löschen ${rule.name}`}
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
              {editingRule ? 'Margenregel bearbeiten' : 'Neue Margenregel anlegen'}
            </DialogTitle>
            <DialogDescription>
              Legen Sie Bedingungen und Margenaufschläge für diese Regel fest.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmitRule} noValidate className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rule-name">Bezeichnung *</Label>
              <Input
                id="rule-name"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="z.B. Bosch Verschleißteile"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rule-priority">Priorität</Label>
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
                <Label htmlFor="rule-markup">Aufschlag (%)</Label>
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
                  placeholder="z.B. 35"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rule-brand">Marke (optional)</Label>
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
                    <SelectValue placeholder="Alle Marken" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Alle Marken</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rule-revenue-group">Erlösgruppe (optional)</Label>
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
                    <SelectValue placeholder="Alle Erlösgruppen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Alle Erlösgruppen</SelectItem>
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
                <Label htmlFor="rule-cost-min">Min. Einkaufspreis (€)</Label>
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
                <Label htmlFor="rule-cost-max">Max. Einkaufspreis (€)</Label>
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
              <Label htmlFor="rule-rounding">Rundungsstrategie</Label>
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
                  <SelectItem value="NONE">Keine Rundung</SelectItem>
                  <SelectItem value="ROUND_90">Auf .90 runden</SelectItem>
                  <SelectItem value="ROUND_99">Auf .99 runden</SelectItem>
                  <SelectItem value="WHOLE_EURO">Auf vollen Euro runden</SelectItem>
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
                  UVP des Lieferanten bevorzugen (falls vorhanden)
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
                  Margenregel aktiv
                </Label>
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={createRule.isPending || updateRule.isPending}
              >
                {createRule.isPending || updateRule.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {editingRule ? 'Änderungen speichern' : 'Regel erstellen'}
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
              Margenregel wirklich löschen?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Möchten Sie die Margenregel &quot;{deleteCandidate?.name}&quot; wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
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
              Löschen bestätigen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

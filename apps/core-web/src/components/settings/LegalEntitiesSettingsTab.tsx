import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import {
  type LegalEntityRecord,
  type UpdateLegalEntityPayload,
  useCreateLegalEntity,
  useLegalEntities,
  useUpdateLegalEntity,
} from '@/api/site-admin'
import { DocumentSaveIndicator } from '@/components/document-save/DocumentSaveIndicator'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
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
import { useDebouncedAutoSave } from '@/hooks/useDebouncedAutoSave'

type SellerFormState = {
  name: string
  addressStreet: string
  addressLine2: string
  addressZip: string
  addressCity: string
  taxNumber: string
  vatId: string
  iban: string
  bic: string
  bankName: string
  email: string
  phone: string
  registrationNumber: string
  registrationCourt: string
  representatives: string
  paymentTermsDays: string
  paymentTermsText: string
}

function toFormState(entity: LegalEntityRecord): SellerFormState {
  return {
    name: entity.name,
    addressStreet: entity.address_street ?? '',
    addressLine2: entity.address_line2 ?? '',
    addressZip: entity.address_zip ?? '',
    addressCity: entity.address_city ?? '',
    taxNumber: entity.tax_number ?? '',
    vatId: entity.vat_id ?? '',
    iban: entity.iban ?? '',
    bic: entity.bic ?? '',
    bankName: entity.bank_name ?? '',
    email: entity.email ?? '',
    phone: entity.phone ?? '',
    registrationNumber: entity.registration_number ?? '',
    registrationCourt: entity.registration_court ?? '',
    representatives: entity.representatives ?? '',
    paymentTermsDays:
      entity.payment_terms_days === null ? '' : String(entity.payment_terms_days),
    paymentTermsText: entity.payment_terms_text ?? '',
  }
}

function buildUpdatePayload(
  entityId: string,
  form: SellerFormState,
): UpdateLegalEntityPayload {
  const paymentTermsDays =
    form.paymentTermsDays.trim() === ''
      ? null
      : Number.parseInt(form.paymentTermsDays, 10)

  return {
    id: entityId,
    name: form.name.trim(),
    addressStreet: form.addressStreet,
    addressLine2: form.addressLine2,
    addressZip: form.addressZip,
    addressCity: form.addressCity,
    taxNumber: form.taxNumber,
    vatId: form.vatId,
    iban: form.iban,
    bic: form.bic,
    bankName: form.bankName,
    email: form.email,
    phone: form.phone,
    registrationNumber: form.registrationNumber,
    registrationCourt: form.registrationCourt,
    representatives: form.representatives,
    paymentTermsDays,
    paymentTermsText: form.paymentTermsText,
  }
}

function formatMissingField(field: string, countryIso: 'AT' | 'DE') {
  switch (field) {
    case 'tax_number_or_vat_id':
      return countryIso === 'DE' ? 'Tax number or VAT ID' : 'Tax number or VAT ID'
    case 'vat_id':
      return countryIso === 'AT' ? 'UID (VAT ID)' : 'VAT ID'
    case 'payment_terms':
      return 'Payment terms'
    case 'address_street':
      return 'Street address'
    case 'address_zip':
      return 'Postal code'
    case 'address_city':
      return 'City'
    default:
      return field.replaceAll('_', ' ')
  }
}

function LegalEntitySellerForm({
  entity,
  onSaved,
}: {
  entity: LegalEntityRecord
  onSaved: (entity: LegalEntityRecord) => void
}) {
  const updateMutation = useUpdateLegalEntity()
  const [form, setForm] = React.useState<SellerFormState>(() => toFormState(entity))
  const lastSavedRef = React.useRef(JSON.stringify(toFormState(entity)))
  const updateMutationRef = React.useRef(updateMutation)
  const previousEntityIdRef = React.useRef(entity.id)

  React.useEffect(() => {
    updateMutationRef.current = updateMutation
  })

  React.useEffect(() => {
    if (previousEntityIdRef.current === entity.id) {
      return
    }

    const nextForm = toFormState(entity)
    setForm(nextForm)
    lastSavedRef.current = JSON.stringify(nextForm)
    previousEntityIdRef.current = entity.id
  }, [entity])

  const saveSellerSettings = React.useCallback(
    async (snapshot: SellerFormState, signal: AbortSignal) => {
      const serialized = JSON.stringify(snapshot)
      if (serialized === lastSavedRef.current) {
        return
      }

      const updated = await updateMutationRef.current.mutateAsync(
        buildUpdatePayload(entity.id, snapshot),
      )
      if (signal.aborted) {
        return
      }

      lastSavedRef.current = serialized
      onSaved(updated)
    },
    [entity.id, onSaved],
  )

  const { saveStatus, triggerAutoSave } = useDebouncedAutoSave({
    save: saveSellerSettings,
    shouldSave: (snapshot) => snapshot.name.trim().length > 0,
  })

  const updateField = <K extends keyof SellerFormState>(key: K, value: SellerFormState[K]) => {
    setForm((current) => {
      const next = { ...current, [key]: value }
      triggerAutoSave(next)
      return next
    })
  }

  const readiness = entity.seller_readiness

  return (
    <div className="space-y-6 rounded-lg border bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="font-medium">{entity.name}</h4>
          <p className="text-sm text-slate-500">
            Seller identity for {entity.country_iso} invoices. Country is fixed after creation.
          </p>
        </div>
        <DocumentSaveIndicator status={saveStatus} />
      </div>

      <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-3">
          <StatusBadge status={readiness.is_ready ? 'ACTIVE' : 'INACTIVE'} />
          <span className="text-sm font-medium text-slate-700">
            {readiness.is_ready ? 'Ready for invoice issuance' : 'Seller identity incomplete'}
          </span>
        </div>
        {!readiness.is_ready ? (
          <p className="mt-2 text-sm text-slate-600">
            Missing:{' '}
            {readiness.missing_fields
              .map((field) => formatMissingField(field, entity.country_iso))
              .join(', ')}
          </p>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="seller-name">Legal name</Label>
          <Input
            id="seller-name"
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-street">Street</Label>
          <Input
            id="seller-street"
            value={form.addressStreet}
            onChange={(event) => updateField('addressStreet', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-line2">Address line 2</Label>
          <Input
            id="seller-line2"
            value={form.addressLine2}
            onChange={(event) => updateField('addressLine2', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-zip">Postal code</Label>
          <Input
            id="seller-zip"
            value={form.addressZip}
            onChange={(event) => updateField('addressZip', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-city">City</Label>
          <Input
            id="seller-city"
            value={form.addressCity}
            onChange={(event) => updateField('addressCity', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-tax-number">
            {entity.country_iso === 'DE' ? 'Tax number (Steuernummer)' : 'Tax number'}
          </Label>
          <Input
            id="seller-tax-number"
            value={form.taxNumber}
            onChange={(event) => updateField('taxNumber', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-vat-id">
            {entity.country_iso === 'AT' ? 'UID' : 'VAT ID (USt-IdNr.)'}
          </Label>
          <Input
            id="seller-vat-id"
            value={form.vatId}
            onChange={(event) => updateField('vatId', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-iban">IBAN (optional)</Label>
          <Input
            id="seller-iban"
            value={form.iban}
            onChange={(event) => updateField('iban', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-bic">BIC (optional)</Label>
          <Input
            id="seller-bic"
            value={form.bic}
            onChange={(event) => updateField('bic', event.target.value)}
          />
        </div>
        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="seller-bank-name">Bank name (optional)</Label>
          <Input
            id="seller-bank-name"
            value={form.bankName}
            onChange={(event) => updateField('bankName', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-email">Email</Label>
          <Input
            id="seller-email"
            type="email"
            value={form.email}
            onChange={(event) => updateField('email', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-phone">Phone</Label>
          <Input
            id="seller-phone"
            value={form.phone}
            onChange={(event) => updateField('phone', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-registration-number">Registration number</Label>
          <Input
            id="seller-registration-number"
            value={form.registrationNumber}
            onChange={(event) => updateField('registrationNumber', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-registration-court">Registration court</Label>
          <Input
            id="seller-registration-court"
            value={form.registrationCourt}
            onChange={(event) => updateField('registrationCourt', event.target.value)}
          />
        </div>

        <div className="grid gap-2 md:col-span-2">
          <Label htmlFor="seller-representatives">Representatives</Label>
          <textarea
            id="seller-representatives"
            className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.representatives}
            onChange={(event) => updateField('representatives', event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="seller-payment-days">Payment terms (days)</Label>
          <Input
            id="seller-payment-days"
            type="number"
            min={0}
            max={365}
            value={form.paymentTermsDays}
            onChange={(event) => updateField('paymentTermsDays', event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seller-payment-text">Payment terms text</Label>
          <textarea
            id="seller-payment-text"
            className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.paymentTermsText}
            onChange={(event) => updateField('paymentTermsText', event.target.value)}
          />
        </div>
      </div>
    </div>
  )
}

export function LegalEntitiesSettingsTab() {
  const { data: entities, isLoading } = useLegalEntities()
  const createMutation = useCreateLegalEntity()
  const updateMutation = useUpdateLegalEntity()

  const [name, setName] = React.useState('')
  const [countryIso, setCountryIso] = React.useState<'AT' | 'DE'>('AT')
  const [selectedEntityId, setSelectedEntityId] = React.useState<string | null>(null)
  const [selectedEntity, setSelectedEntity] = React.useState<LegalEntityRecord | null>(null)

  React.useEffect(() => {
    if (!selectedEntityId && entities?.length) {
      setSelectedEntityId(entities[0].id)
      setSelectedEntity(entities[0])
    }
  }, [entities, selectedEntityId])

  React.useEffect(() => {
    const next = entities?.find((entity) => entity.id === selectedEntityId) ?? null
    if (next) {
      setSelectedEntity(next)
    }
  }, [entities, selectedEntityId])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return

    try {
      const created = await createMutation.mutateAsync({ name: name.trim(), countryIso })
      toast.success('Legal entity created')
      setName('')
      setSelectedEntityId(created.id)
      setSelectedEntity(created)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create legal entity')
    }
  }

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      const updated = await updateMutation.mutateAsync({ id, isActive: !isActive })
      if (selectedEntityId === id) {
        setSelectedEntity(updated)
      }
      toast.success(isActive ? 'Legal entity deactivated' : 'Legal entity reactivated')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update legal entity')
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Legal Entities</h3>
        <p className="text-sm text-muted-foreground">
          Legal entities own seller identity for invoices. Sites inherit the entity configured here.
        </p>
      </div>

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-[1fr_160px_auto] md:items-end">
          <div className="grid gap-2">
            <Label htmlFor="legal-entity-name">Name</Label>
            <Input
              id="legal-entity-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Example GmbH"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="legal-entity-country">Country</Label>
            <Select value={countryIso} onValueChange={(value) => setCountryIso(value as 'AT' | 'DE')}>
              <SelectTrigger id="legal-entity-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AT">Austria (AT)</SelectItem>
                <SelectItem value="DE">Germany (DE)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
            + Legal Entity
          </Button>
        </form>
      </div>

      <div className="rounded-lg border bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Readiness</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(entities ?? []).map((entity) => (
              <TableRow
                key={entity.id}
                data-state={entity.id === selectedEntityId ? 'selected' : undefined}
                className={entity.id === selectedEntityId ? 'bg-slate-50' : undefined}
                onClick={() => setSelectedEntityId(entity.id)}
              >
                <TableCell className="font-medium">{entity.name}</TableCell>
                <TableCell>{entity.country_iso}</TableCell>
                <TableCell>
                  <StatusBadge status={entity.seller_readiness.is_ready ? 'ACTIVE' : 'INACTIVE'} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={entity.is_active ? 'ACTIVE' : 'INACTIVE'} />
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={updateMutation.isPending}
                    onClick={(event) => {
                      event.stopPropagation()
                      void toggleActive(entity.id, entity.is_active)
                    }}
                  >
                    {entity.is_active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {selectedEntity ? (
        <LegalEntitySellerForm
          entity={selectedEntity}
          onSaved={(updated) => setSelectedEntity(updated)}
        />
      ) : null}
    </div>
  )
}

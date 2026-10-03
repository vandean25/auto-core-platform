import type { ReactNode } from 'react'
import { toast } from 'sonner'
import type { components } from '@/api/generated/openapi'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  bilingualLabel,
  VEHICLE_NOVA_CLASS_OPTIONS,
  VEHICLE_REGULATORY_FIELDS,
  VEHICLE_REGULATORY_SECTION,
} from './vehicle-regulatory-copy'

export type VehicleNovaClass = NonNullable<
  components['schemas']['CreateVehicleDto']['nova_class']
>

export type VehicleRegulatoryValues = {
  first_registration_date?: string | null
  co2_wltp_g_km?: number | null
  co2_nedc_g_km?: number | null
  typenschein_no?: string | null
  nova_class?: VehicleNovaClass | null
  emission_class?: string | null
}

type VehicleRegulatorySectionProps = {
  values: VehicleRegulatoryValues
  onChange: (patch: Partial<VehicleRegulatoryValues>) => void
  mode: 'form' | 'inline'
  renderInlineField?: (
    field: keyof VehicleRegulatoryValues,
    label: string,
    value: string,
    onSave: (next: string) => Promise<void>,
  ) => ReactNode
}

function toInputString(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value)
}

export function parseCo2FieldInput(next: string): number | null {
  if (next === '') {
    return null
  }
  const parsed = Number(next)
  if (!Number.isInteger(parsed)) {
    throw new Error('CO2 value must be a whole number')
  }
  return parsed
}

const CO2_INLINE_VALIDATION_ERROR =
  'CO₂ must be a whole number between 0 and 600 / CO₂ muss eine ganze Zahl zwischen 0 und 600 sein'

function applyInlineCo2Change(
  field: 'co2_wltp_g_km' | 'co2_nedc_g_km',
  next: string,
  onChange: (patch: Partial<VehicleRegulatoryValues>) => void,
): void {
  try {
    onChange({ [field]: parseCo2FieldInput(next) })
  } catch (error) {
    toast.error(CO2_INLINE_VALIDATION_ERROR)
    throw error
  }
}

export function VehicleRegulatorySection({
  values,
  onChange,
  mode,
  renderInlineField,
}: VehicleRegulatorySectionProps) {
  const sectionTitle = bilingualLabel(VEHICLE_REGULATORY_SECTION)

  if (mode === 'inline' && renderInlineField) {
    return (
      <div className="space-y-3 pt-3 border-t">
        <h3 className="text-sm font-semibold text-slate-700">{sectionTitle}</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {renderInlineField(
            'first_registration_date',
            bilingualLabel(VEHICLE_REGULATORY_FIELDS.firstRegistrationDate),
            toInputString(values.first_registration_date),
            async (next) => onChange({ first_registration_date: next || null }),
          )}
          {renderInlineField(
            'co2_wltp_g_km',
            bilingualLabel(VEHICLE_REGULATORY_FIELDS.co2Wltp),
            toInputString(values.co2_wltp_g_km),
            async (next) => applyInlineCo2Change('co2_wltp_g_km', next, onChange),
          )}
          {renderInlineField(
            'co2_nedc_g_km',
            bilingualLabel(VEHICLE_REGULATORY_FIELDS.co2Nedc),
            toInputString(values.co2_nedc_g_km),
            async (next) => applyInlineCo2Change('co2_nedc_g_km', next, onChange),
          )}
          {renderInlineField(
            'typenschein_no',
            bilingualLabel(VEHICLE_REGULATORY_FIELDS.typenscheinNo),
            toInputString(values.typenschein_no),
            async (next) => onChange({ typenschein_no: next || null }),
          )}
          {renderInlineField(
            'emission_class',
            bilingualLabel(VEHICLE_REGULATORY_FIELDS.emissionClass),
            toInputString(values.emission_class),
            async (next) => onChange({ emission_class: next || null }),
          )}
        </div>
        <div>
          <div className="text-muted-foreground text-xs mb-1">
            {bilingualLabel(VEHICLE_REGULATORY_FIELDS.novaClass)}
          </div>
          <Select
            value={values.nova_class ?? ''}
            onValueChange={(next) =>
              onChange({ nova_class: (next || null) as VehicleNovaClass | null })
            }
          >
            <SelectTrigger
              className="h-9"
              aria-label={bilingualLabel(VEHICLE_REGULATORY_FIELDS.novaClass)}
            >
              <SelectValue placeholder={bilingualLabel({ en: 'Select', de: 'Auswählen' })} />
            </SelectTrigger>
            <SelectContent>
              {VEHICLE_NOVA_CLASS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <h3 className="text-sm font-semibold text-slate-700">{sectionTitle}</h3>
      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">
            {bilingualLabel(VEHICLE_REGULATORY_FIELDS.firstRegistrationDate)}
          </span>
          <Input
            type="date"
            aria-label={bilingualLabel(VEHICLE_REGULATORY_FIELDS.firstRegistrationDate)}
            value={toInputString(values.first_registration_date)}
            onChange={(event) =>
              onChange({ first_registration_date: event.target.value || null })
            }
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">{bilingualLabel(VEHICLE_REGULATORY_FIELDS.co2Wltp)}</span>
          <Input
            type="number"
            min={0}
            max={600}
            aria-label={bilingualLabel(VEHICLE_REGULATORY_FIELDS.co2Wltp)}
            value={toInputString(values.co2_wltp_g_km)}
            onChange={(event) => {
              try {
                onChange({ co2_wltp_g_km: parseCo2FieldInput(event.target.value) })
              } catch {
                // ignore invalid partial input while typing
              }
            }}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">{bilingualLabel(VEHICLE_REGULATORY_FIELDS.co2Nedc)}</span>
          <Input
            type="number"
            min={0}
            max={600}
            aria-label={bilingualLabel(VEHICLE_REGULATORY_FIELDS.co2Nedc)}
            value={toInputString(values.co2_nedc_g_km)}
            onChange={(event) => {
              try {
                onChange({ co2_nedc_g_km: parseCo2FieldInput(event.target.value) })
              } catch {
                // ignore invalid partial input while typing
              }
            }}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">
            {bilingualLabel(VEHICLE_REGULATORY_FIELDS.typenscheinNo)}
          </span>
          <Input
            aria-label={bilingualLabel(VEHICLE_REGULATORY_FIELDS.typenscheinNo)}
            value={toInputString(values.typenschein_no)}
            onChange={(event) => onChange({ typenschein_no: event.target.value || null })}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">{bilingualLabel(VEHICLE_REGULATORY_FIELDS.novaClass)}</span>
          <Select
            value={values.nova_class ?? ''}
            onValueChange={(next) =>
              onChange({ nova_class: (next || null) as VehicleNovaClass | null })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={bilingualLabel({ en: 'Select', de: 'Auswählen' })} />
            </SelectTrigger>
            <SelectContent>
              {VEHICLE_NOVA_CLASS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1 text-sm col-span-2">
          <span className="text-slate-600">
            {bilingualLabel(VEHICLE_REGULATORY_FIELDS.emissionClass)}
          </span>
          <Input
            aria-label={bilingualLabel(VEHICLE_REGULATORY_FIELDS.emissionClass)}
            value={toInputString(values.emission_class)}
            onChange={(event) => onChange({ emission_class: event.target.value || null })}
          />
        </label>
      </div>
    </div>
  )
}

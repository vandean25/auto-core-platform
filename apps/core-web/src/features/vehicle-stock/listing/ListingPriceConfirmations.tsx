import { useTranslation } from 'react-i18next'
import type { VehicleListingExportFieldIssue } from '@/api/vehicle-listing'
import { CapabilityGate } from '@/components/CapabilityGate'
import { Checkbox } from '@/components/ui/checkbox'
import { ListingFieldErrors } from './ListingFieldErrors'
import type { ListingDraft } from './listing-draft'

type Confirmations = Pick<ListingDraft, 'nova_included_confirmed' | 'mandatory_fees_included_confirmed'>

type Props = {
  values: Confirmations
  issues: VehicleListingExportFieldIssue[]
  onChange: (patch: Partial<Confirmations>) => void
}

/** Price confirmations; the NoVA confirmation is shown only when the nova capability is on. */
export function ListingPriceConfirmations({ values, issues, onChange }: Props) {
  const { t } = useTranslation('vehicleStock')

  return (
    <div className="flex flex-col gap-2">
      <CapabilityGate capability="nova">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={values.nova_included_confirmed}
            onCheckedChange={(checked) => onChange({ nova_included_confirmed: checked === true })}
          />
          {t('listing.fields.novaIncluded')}
        </label>
        <ListingFieldErrors issues={issues} field="nova_included_confirmed" />
      </CapabilityGate>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={values.mandatory_fees_included_confirmed}
          onCheckedChange={(checked) => onChange({ mandatory_fees_included_confirmed: checked === true })}
        />
        {t('listing.fields.mandatoryFeesIncluded')}
      </label>
      <ListingFieldErrors issues={issues} field="mandatory_fees_included_confirmed" />
    </div>
  )
}

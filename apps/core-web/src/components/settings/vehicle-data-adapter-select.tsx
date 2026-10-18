import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function VehicleDataAdapterSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  options: readonly { value: string; label: string }[]
  disabled?: boolean
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('settings')
  return (
    <div className='space-y-2'>
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value || '__none__'}
        disabled={disabled}
        onValueChange={(nextValue) => onChange(nextValue === '__none__' ? '' : nextValue)}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder={t('vehicleData.catalog.notConfigured')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value='__none__'>{t('vehicleData.catalog.notConfigured')}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

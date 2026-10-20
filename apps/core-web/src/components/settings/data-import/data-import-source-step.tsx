import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'

import { formatImportEntityTypeLabel } from '@/lib/i18n/enum-labels'
import { IMPORT_ENTITY_TYPE_VALUES } from '@/lib/i18n/enum-registry'
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

import type { ImportEntityTypeUi } from './import-field-labels'

export type DataImportSourceStepProps = {
  entityType: ImportEntityTypeUi
  onEntityTypeChange: (entityType: ImportEntityTypeUi) => void
  sourceSystem: string
  onSourceSystemChange: (sourceSystem: string) => void
  selectedVendorId: string
  onVendorChange: (vendorId: string) => void
  vendors: { id: string; name: string }[]
  templateFields: string[]
  onDownloadTemplate: () => void
  onContinue: () => void
}

/** Wizard step 1: entity, source system and vendor of the import. */
export function DataImportSourceStep(props: DataImportSourceStepProps) {
  const { t } = useTranslation(['settings', 'common'])

  return (
    <section className="space-y-4" aria-labelledby="import-step-source">
      <h4 id="import-step-source" className="font-medium">
        {t('dataImport.source.title')}
      </h4>
      <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
        <div className="space-y-2">
          <Label htmlFor="import-entity">{t('dataImport.source.entityLabel')}</Label>
          <Select
            value={props.entityType}
            onValueChange={(value) => props.onEntityTypeChange(value as ImportEntityTypeUi)}
          >
            <SelectTrigger id="import-entity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMPORT_ENTITY_TYPE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {formatImportEntityTypeLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="import-source">{t('dataImport.source.sourceSystemLabel')}</Label>
          <Input
            id="import-source"
            value={props.sourceSystem}
            onChange={(event) => props.onSourceSystemChange(event.target.value)}
          />
        </div>
        {props.entityType === 'SUPPLIER_PRICE_LIST' ? (
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="import-vendor">{t('dataImport.source.vendorLabel')}</Label>
            <Select
              value={props.selectedVendorId || '__none__'}
              onValueChange={(value) => props.onVendorChange(value === '__none__' ? '' : value)}
            >
              <SelectTrigger id="import-vendor" aria-label={t('dataImport.source.vendorAria')}>
                <SelectValue placeholder={t('dataImport.source.vendorPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('dataImport.source.vendorPlaceholder')}</SelectItem>
                {props.vendors.map((vendor) => (
                  <SelectItem key={vendor.id} value={vendor.id}>
                    {vendor.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={props.onDownloadTemplate}>
          <Download className="mr-2 h-4 w-4" />
          {t('dataImport.source.downloadTemplate')}
        </Button>
        <Button
          type="button"
          disabled={props.entityType === 'SUPPLIER_PRICE_LIST' && !props.selectedVendorId}
          onClick={props.onContinue}
        >
          {t('dataImport.source.continue')}
        </Button>
      </div>
      {props.templateFields.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('dataImport.source.templateFields', {
            fields: props.templateFields.join(', '),
          })}
        </p>
      ) : null}
    </section>
  )
}

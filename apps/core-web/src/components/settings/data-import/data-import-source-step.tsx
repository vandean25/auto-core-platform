import { useTranslation } from 'react-i18next'
import { Download, Info } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

import type { ImportSource } from '@/api/imports'
import { formatImportEntityTypeLabel } from '@/lib/i18n/enum-labels'
import { toImportEntityTypeUi } from '@/lib/i18n/enum-registry'
import { Button } from '@/components/ui/button'
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
  entityTypes: ImportEntityTypeUi[]
  onEntityTypeChange: (entityType: ImportEntityTypeUi) => void
  entityTypesFailed: boolean
  onRetryEntityTypes: () => void
  sourceSystem: string
  onSourceSystemChange: (sourceSystem: string) => void
  sources: ImportSource[]
  sourcesFailed: boolean
  onRetrySources: () => void
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
  const hasSelectedSource = props.sources.some((source) => source.key === props.sourceSystem)

  return (
    <section className="space-y-4" aria-labelledby="import-step-source">
      <div className="flex items-center gap-1.5">
        <h4 id="import-step-source" className="font-medium">
          {t('dataImport.source.title')}
        </h4>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground inline-flex items-center justify-center h-11 w-11 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t('dataImport.consent.infoAria')}
            >
              <Info className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 text-xs space-y-1">
            <p className="font-medium">{t('dataImport.consent.title')}</p>
            <p>{t('dataImport.consent.description')}</p>
          </PopoverContent>
        </Popover>
      </div>
      <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
        <div className="space-y-2">
          <Label htmlFor="import-entity">{t('dataImport.source.entityLabel')}</Label>
          <Select
            value={props.entityType}
            onValueChange={(value) => props.onEntityTypeChange(toImportEntityTypeUi(value))}
          >
            <SelectTrigger
              id="import-entity"
              aria-describedby={props.entityTypesFailed ? 'import-entity-error' : undefined}
            >
              <SelectValue>{formatImportEntityTypeLabel(props.entityType)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {props.entityTypes.map((value) => (
                <SelectItem key={value} value={value}>
                  {formatImportEntityTypeLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {props.entityTypesFailed ? (
            <div className="flex flex-wrap items-center gap-2">
              <p id="import-entity-error" className="text-sm text-destructive">
                {t('dataImport.source.entityTypesLoadFailed')}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={props.onRetryEntityTypes}
              >
                {t('common:actions.retry')}
              </Button>
            </div>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="import-source">{t('dataImport.source.sourceSystemLabel')}</Label>
          <Select
            value={props.sourceSystem}
            onValueChange={(value) => props.onSourceSystemChange(value)}
            disabled={props.sources.length === 0}
          >
            <SelectTrigger
              id="import-source"
              aria-describedby={props.sourcesFailed ? 'import-source-error' : undefined}
            >
              <SelectValue placeholder={t('dataImport.source.sourceSystemPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {props.sources.map((source) => (
                <SelectItem key={source.id} value={source.key}>
                  {source.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {props.sourcesFailed ? (
            <div className="flex flex-wrap items-center gap-2">
              <p id="import-source-error" className="text-sm text-destructive">
                {t('dataImport.sources.loadFailed')}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={props.onRetrySources}>
                {t('common:actions.retry')}
              </Button>
            </div>
          ) : props.sources.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t('dataImport.source.noSources')}
            </p>
          ) : null}
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
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" onClick={props.onDownloadTemplate}>
            <Download className="mr-2 h-4 w-4" />
            {t('dataImport.source.downloadTemplate')}
          </Button>
          {props.templateFields.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 text-muted-foreground hover:text-foreground"
                  aria-label={t('dataImport.source.templateFieldsInfo')}
                >
                  <Info className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 text-xs">
                <p>
                  {t('dataImport.source.templateFields', {
                    fields: props.templateFields.join(', '),
                  })}
                </p>
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
        <Button
          type="button"
          disabled={
            (props.entityType === 'SUPPLIER_PRICE_LIST' && !props.selectedVendorId) ||
            !hasSelectedSource
          }
          onClick={props.onContinue}
        >
          {t('dataImport.source.continue')}
        </Button>
      </div>
    </section>
  )
}

import { useTranslation } from 'react-i18next'
import { Loader2, Save } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

import { DataImportMappingTable } from './data-import-mapping-table'
import type { ImportEntityTypeUi, ImportFieldDefinition } from './import-field-labels'
import type { ImportWizardOptions } from './import-wizard-logic'

type ImportOptionCheckboxProps = {
  id: string
  label: string
  checked: boolean | undefined
  onCheckedChange: (checked: boolean) => void
}

function ImportOptionCheckbox(props: ImportOptionCheckboxProps) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Checkbox
        id={props.id}
        checked={props.checked}
        onCheckedChange={(checked) => props.onCheckedChange(checked === true)}
      />
      <Label htmlFor={props.id} className="font-normal cursor-pointer">
        {props.label}
      </Label>
    </div>
  )
}

export type DataImportMappingStepProps = {
  entityType: ImportEntityTypeUi
  fields: ImportFieldDefinition[]
  mapping: Record<string, string>
  csvHeaders: string[]
  previewRows: string[][]
  options: ImportWizardOptions
  missingRequired: string[]
  profiles: { id: string; name: string }[]
  profileName: string
  onProfileNameChange: (name: string) => void
  onLoadProfile: (profileId: string) => void
  onSaveProfile: () => void
  isSavingProfile: boolean
  onMappingChange: (fieldKey: string, csvColumn: string) => void
  onOptionsChange: (patch: Partial<ImportWizardOptions>) => void
  onRunDryRun: () => void
  isDryRunPending: boolean
  canRunDryRun: boolean
  onBack: () => void
}

/** Wizard step 3: column mapping, import options and the preview of the uploaded file. */
export function DataImportMappingStep(props: DataImportMappingStepProps) {
  const { t } = useTranslation(['settings', 'common'])

  return (
    <section className="space-y-4" aria-labelledby="import-step-mapping">
      <h4 id="import-step-mapping" className="font-medium">
        {t('dataImport.mapping.title')}
      </h4>

      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="space-y-2 flex-1 max-w-xs">
          <Label htmlFor="import-profile-load">{t('dataImport.mapping.savedProfile')}</Label>
          <Select onValueChange={props.onLoadProfile}>
            <SelectTrigger id="import-profile-load">
              <SelectValue placeholder={t('dataImport.mapping.loadProfilePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {props.profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 gap-2 items-end">
          <div className="space-y-2 flex-1 max-w-xs">
            <Label htmlFor="import-profile-name">{t('dataImport.mapping.saveAs')}</Label>
            <Input
              id="import-profile-name"
              value={props.profileName}
              onChange={(event) => props.onProfileNameChange(event.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={props.isSavingProfile}
            onClick={props.onSaveProfile}
          >
            {props.isSavingProfile ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {t('dataImport.mapping.saveProfile')}
          </Button>
        </div>
      </div>

      <DataImportMappingTable
        entityType={props.entityType}
        fields={props.fields}
        mapping={props.mapping}
        csvHeaders={props.csvHeaders}
        onMappingChange={props.onMappingChange}
      />

      {props.missingRequired.length > 0 ? (
        <p className="text-sm text-destructive" role="alert">
          {t('dataImport.mapping.missingRequired', { fields: props.missingRequired.join(', ') })}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 max-w-3xl">
        <ImportOptionCheckbox
          id="import-opt-update-existing"
          label={t('dataImport.mapping.options.updateExisting')}
          checked={props.options.update_existing}
          onCheckedChange={(checked) => props.onOptionsChange({ update_existing: checked })}
        />
        <ImportOptionCheckbox
          id="import-opt-fill-empty"
          label={t('dataImport.mapping.options.fillEmptyOnly')}
          checked={props.options.fill_empty_only}
          onCheckedChange={(checked) => props.onOptionsChange({ fill_empty_only: checked })}
        />
        {props.entityType === 'VEHICLE' ? (
          <ImportOptionCheckbox
            id="import-opt-allow-missing-vin"
            label={t('dataImport.mapping.options.allowMissingVin')}
            checked={props.options.allow_missing_vin}
            onCheckedChange={(checked) => props.onOptionsChange({ allow_missing_vin: checked })}
          />
        ) : null}
        {props.entityType === 'CUSTOMER' ? (
          <ImportOptionCheckbox
            id="import-opt-invalid-vat-error"
            label={t('dataImport.mapping.options.invalidVatAsError')}
            checked={props.options.invalid_vat_as_error}
            onCheckedChange={(checked) => props.onOptionsChange({ invalid_vat_as_error: checked })}
          />
        ) : null}
        {props.entityType === 'SUPPLIER_PRICE_LIST' ? (
          <ImportOptionCheckbox
            id="import-opt-create-catalog"
            label={t('dataImport.mapping.options.createCatalogItems')}
            checked={props.options.create_new_catalog_items}
            onCheckedChange={(checked) =>
              props.onOptionsChange({ create_new_catalog_items: checked })
            }
          />
        ) : null}
      </div>

      {props.previewRows.length > 0 ? (
        <div className="space-y-2">
          <h5 className="text-sm font-medium">{t('dataImport.mapping.previewTitle')}</h5>
          <div className="overflow-x-auto border rounded-md max-h-64">
            <Table>
              <TableHeader>
                <TableRow>
                  {props.csvHeaders.map((header) => (
                    <TableHead key={header} className="whitespace-nowrap text-xs">
                      {header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {props.previewRows.map((row, rowIndex) => (
                  <TableRow key={rowIndex}>
                    {props.csvHeaders.map((_, colIndex) => (
                      <TableCell key={colIndex} className="text-xs whitespace-nowrap">
                        {row[colIndex] ?? ''}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={props.onBack}>
          {t('dataImport.mapping.back')}
        </Button>
        <Button
          type="button"
          disabled={!props.canRunDryRun}
          onClick={props.onRunDryRun}
        >
          {props.isDryRunPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {t('dataImport.mapping.runDryRun')}
        </Button>
      </div>
    </section>
  )
}

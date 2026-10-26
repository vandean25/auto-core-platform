import type { ImportEntityTypeUi } from './import-field-labels'
import type { ImportRowFilter } from './import-wizard-logic'
import { EMPTY_CSV_SELECTION, type ImportWizardState } from './use-import-wizard-state'
import type { useImportCsvFile } from './use-import-csv-file'

type CsvFileApi = ReturnType<typeof useImportCsvFile>

export function changeImportEntityType(
  wizard: ImportWizardState,
  sourceSystem: string,
  setSourceSystem: (value: string) => void,
  value: ImportEntityTypeUi,
) {
  wizard.setEntityType(value)
  if (value !== 'SUPPLIER_PRICE_LIST') {
    wizard.clearVendorSelection()
  } else if (sourceSystem === 'incadea') {
    setSourceSystem('supplier')
  }
  wizard.resetMapping()
  wizard.resetDryRun()
  wizard.setStep(1)
}

export function changeImportSourceSystem(
  wizard: ImportWizardState,
  setSourceSystem: (value: string) => void,
  value: string,
) {
  setSourceSystem(value)
  wizard.resetDryRun()
}

export function changeImportVendor(wizard: ImportWizardState, vendorId: string) {
  wizard.setSelectedVendorId(vendorId)
  wizard.setOptions((prev) => ({ ...prev, vendor_id: vendorId || undefined }))
  wizard.resetDryRun()
}

export async function selectImportCsvFile(
  wizard: ImportWizardState,
  csvFile: CsvFileApi,
  selected: File | null,
) {
  wizard.setFile(selected)
  wizard.resetDryRun()
  if (!selected) {
    wizard.applyCsvSelection(EMPTY_CSV_SELECTION)
    return
  }
  const selection = await csvFile.parseCsvFile(selected)
  wizard.applyCsvSelection(selection ?? EMPTY_CSV_SELECTION)
}

export function changeImportMapping(
  wizard: ImportWizardState,
  fieldKey: string,
  csvColumn: string,
) {
  wizard.setMapping((prev) => ({ ...prev, [fieldKey]: csvColumn }))
  wizard.resetDryRun()
}

export function changeImportRowFilter(wizard: ImportWizardState, filter: ImportRowFilter) {
  wizard.setRowFilter(filter)
  wizard.setRowsPage(1)
}

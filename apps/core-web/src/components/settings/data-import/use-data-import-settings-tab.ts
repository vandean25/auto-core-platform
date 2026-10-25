import type { ImportEntityTypeUi } from './import-field-labels'
import type { ImportRowFilter } from './import-wizard-logic'
import {
  changeImportEntityType,
  changeImportMapping,
  changeImportRowFilter,
  changeImportSourceSystem,
  changeImportVendor,
  selectImportCsvFile,
} from './data-import-settings-handlers'
import { useDataImportSettingsTabCore } from './use-data-import-settings-tab-core'
import { useDataImportSettingsTabWorkflow } from './use-data-import-settings-tab-workflow'

export function useDataImportSettingsTab() {
  const core = useDataImportSettingsTabCore()
  const workflow = useDataImportSettingsTabWorkflow(core)

  const handleEntityTypeChange = (value: ImportEntityTypeUi) =>
    changeImportEntityType(core.wizard, core.sourceSystem, core.setSourceSystem, value)

  const handleSourceSystemChange = (value: string) =>
    changeImportSourceSystem(core.wizard, core.setSourceSystem, value)

  const handleVendorChange = (vendorId: string) => changeImportVendor(core.wizard, vendorId)

  const handleFileSelected = async (selected: File | null) =>
    selectImportCsvFile(core.wizard, workflow.csvFile, selected)

  const handleMappingChange = (fieldKey: string, csvColumn: string) =>
    changeImportMapping(core.wizard, fieldKey, csvColumn)

  const handleRowFilterChange = (filter: ImportRowFilter) =>
    changeImportRowFilter(core.wizard, filter)

  return {
    ...core,
    ...workflow,
    handleEntityTypeChange,
    handleSourceSystemChange,
    handleVendorChange,
    handleFileSelected,
    handleMappingChange,
    handleRowFilterChange,
  }
}

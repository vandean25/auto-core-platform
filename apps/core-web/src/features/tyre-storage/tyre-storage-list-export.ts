import type { TFunction } from 'i18next'

type ExportDeps = {
  fetchExport: () => Promise<Response>
  downloadBlob: (blob: Blob, filename: string) => void
  showExportFailed: (message: string) => void
}

const DUE_EXPORT_FILENAME = 'tyre-sets-due-for-swap.csv'

/** Downloads the due-for-swap CSV export; shows a toast when the response is not ok. */
export async function exportDueTyreSetsCsv(deps: ExportDeps, failedMessage: string): Promise<void> {
  const response = await deps.fetchExport()
  if (!response.ok) {
    deps.showExportFailed(failedMessage)
    return
  }
  const text = await response.text()
  deps.downloadBlob(new Blob([text], { type: 'text/csv' }), DUE_EXPORT_FILENAME)
}

export function tyreStorageExportFailedMessage(t: TFunction<'inventory'>): string {
  return t('tyreStorage.list.exportFailed')
}

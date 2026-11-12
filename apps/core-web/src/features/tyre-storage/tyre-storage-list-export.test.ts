import { describe, expect, it, vi } from 'vitest'

import { exportDueTyreSetsCsv, tyreStorageExportFailedMessage } from './tyre-storage-list-export'

describe('exportDueTyreSetsCsv', () => {
  it('downloads CSV text when the export succeeds', async () => {
    const downloadBlob = vi.fn()
    const showExportFailed = vi.fn()
  await exportDueTyreSetsCsv(
      {
        fetchExport: async () =>
          new Response('a,b', { status: 200, headers: { 'Content-Type': 'text/csv' } }),
        downloadBlob,
        showExportFailed,
      },
      'failed',
    )
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'tyre-sets-due-for-swap.csv')
    expect(showExportFailed).not.toHaveBeenCalled()
  })

  it('shows the failed message when the export response is not ok', async () => {
    const downloadBlob = vi.fn()
    const showExportFailed = vi.fn()
    await exportDueTyreSetsCsv(
      {
        fetchExport: async () => new Response('', { status: 500 }),
        downloadBlob,
        showExportFailed,
      },
      'export failed',
    )
    expect(showExportFailed).toHaveBeenCalledWith('export failed')
    expect(downloadBlob).not.toHaveBeenCalled()
  })
})

describe('tyreStorageExportFailedMessage', () => {
  it('reads the inventory namespace key', () => {
    const t = ((key: string) => `translated:${key}`) as never
    expect(tyreStorageExportFailedMessage(t)).toBe('translated:tyreStorage.list.exportFailed')
  })
})

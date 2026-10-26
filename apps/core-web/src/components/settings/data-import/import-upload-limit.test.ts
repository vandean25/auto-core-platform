import { describe, expect, it } from 'vitest'

import {
  IMPORT_UPLOAD_MAX_BYTES,
  IMPORT_UPLOAD_TOO_LARGE_MESSAGE,
  assertImportUploadFileSize,
} from './import-upload-limit'

describe('assertImportUploadFileSize', () => {
  it('rejects files larger than 30 MiB with the German message', () => {
    const file = new File(
      [new Uint8Array(IMPORT_UPLOAD_MAX_BYTES + 1)],
      'big.csv',
      { type: 'text/csv' },
    )

    expect(() => assertImportUploadFileSize(file)).toThrow(
      IMPORT_UPLOAD_TOO_LARGE_MESSAGE,
    )
  })

  it('allows files at exactly 30 MiB', () => {
    const file = new File([new Uint8Array(IMPORT_UPLOAD_MAX_BYTES)], 'ok.csv', {
      type: 'text/csv',
    })

    expect(() => assertImportUploadFileSize(file)).not.toThrow()
  })
})

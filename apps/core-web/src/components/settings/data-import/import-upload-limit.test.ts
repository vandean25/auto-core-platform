import { describe, expect, it } from 'vitest'

import {
  IMPORT_DIRECT_UPLOAD_MAX_BYTES,
  IMPORT_UPLOAD_MAX_BYTES,
  assertImportUploadFileSize,
  usesDirectImportUpload,
} from './import-upload-limit'

const DIRECT_UPLOAD_REQUIRED_MESSAGE = 'too large'

describe('usesDirectImportUpload', () => {
  it('keeps files up to 30 MiB on the HTTP upload path', () => {
    expect(usesDirectImportUpload({ size: IMPORT_UPLOAD_MAX_BYTES })).toBe(false)
  })

  it('sends files above 30 MiB to the direct GCS path', () => {
    expect(usesDirectImportUpload({ size: IMPORT_UPLOAD_MAX_BYTES + 1 })).toBe(true)
  })
})

describe('assertImportUploadFileSize', () => {
  it('allows a file at the direct upload limit', () => {
    expect(() =>
      assertImportUploadFileSize(
        { size: IMPORT_DIRECT_UPLOAD_MAX_BYTES },
        DIRECT_UPLOAD_REQUIRED_MESSAGE,
      ),
    ).not.toThrow()
  })

  it('rejects files above the direct upload limit with the given message', () => {
    expect(() =>
      assertImportUploadFileSize(
        { size: IMPORT_DIRECT_UPLOAD_MAX_BYTES + 1 },
        DIRECT_UPLOAD_REQUIRED_MESSAGE,
      ),
    ).toThrow(DIRECT_UPLOAD_REQUIRED_MESSAGE)
  })
})

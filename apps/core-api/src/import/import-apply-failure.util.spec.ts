import { IMPORT_ERROR_CODES } from './import.constants.js';
import { importJobOptionsWithFailure } from './import-apply-failure.util.js';

describe('importJobOptionsWithFailure', () => {
  it('records the reason with the error code and message', () => {
    expect(
      importJobOptionsWithFailure(
        { cutover_date: '2026-01-01' },
        'apply_error',
        {
          code: IMPORT_ERROR_CODES.INVALID_ENCODING,
          message: 'CSV must be UTF-8 encoded',
        },
      ),
    ).toEqual({
      cutover_date: '2026-01-01',
      apply_failure_reason: 'apply_error',
      apply_failure_code: IMPORT_ERROR_CODES.INVALID_ENCODING,
      apply_failure_message: 'CSV must be UTF-8 encoded',
    });
  });

  it('drops an earlier error code when the next failure carries none', () => {
    expect(
      importJobOptionsWithFailure(
        {
          apply_failure_reason: 'apply_error',
          apply_failure_code: IMPORT_ERROR_CODES.INVALID_ENCODING,
          apply_failure_message: 'CSV must be UTF-8 encoded',
        },
        'retry_exhausted',
      ),
    ).toEqual({ apply_failure_reason: 'retry_exhausted' });
  });
});

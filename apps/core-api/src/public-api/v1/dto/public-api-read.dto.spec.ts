import { describe, expect, it } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PublicListQueryDto } from './public-api-read.dto.js';

function validate(input: Record<string, unknown>) {
  return validateSync(plainToInstance(PublicListQueryDto, input));
}

describe('PublicListQueryDto', () => {
  it('accepts page 1 and the largest allowed page', () => {
    expect(validate({ page: '1' })).toHaveLength(0);
    expect(validate({ page: '10000' })).toHaveLength(0);
  });

  it('rejects a page beyond the bound instead of building an out-of-range offset', () => {
    expect(validate({ page: '10001' })).not.toHaveLength(0);
    expect(validate({ page: '1e30' })).not.toHaveLength(0);
  });
});

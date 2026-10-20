import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readCoreApiSrc(relativePath: string) {
  return readFileSync(join(process.cwd(), 'src', ...relativePath.split('/')), 'utf8');
}

describe('customer master data schema (OpenAPI DTOs)', () => {
  it('documents migration fields on customer detail response DTO', () => {
    expect(
      readCoreApiSrc('customer/dto/customer-detail-api-response.dto.ts'),
    ).toContain('block_level');
  });

  it('documents bill_to on workshop order response DTO', () => {
    expect(
      readCoreApiSrc('workshop/dto/workshop-response.dto.ts'),
    ).toContain('bill_to_customer_id');
  });
});

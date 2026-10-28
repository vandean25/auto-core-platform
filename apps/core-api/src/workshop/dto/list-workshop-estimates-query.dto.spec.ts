import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListWorkshopEstimatesQueryDto } from './list-workshop-estimates-query.dto.js';

async function failing(query: Record<string, unknown>) {
  const errors = await validate(
    plainToInstance(ListWorkshopEstimatesQueryDto, query),
  );
  return errors.map((error) => error.property).sort();
}

describe('ListWorkshopEstimatesQueryDto', () => {
  it('accepts no filter, and the filters of the MCP tool', async () => {
    expect(await failing({})).toEqual([]);
    expect(
      await failing({
        customerId: '00000000-0000-4000-8000-000000000001',
        orderId: '00000000-0000-4000-8000-000000000002',
        status: 'SENT',
        sentFrom: '2026-10-01',
        sentTo: '2026-10-31',
        pageSize: '100',
        cursor: 'abc',
      }),
    ).toEqual([]);
  });

  it('allows up to 100 per page for the UI and refuses more, zero and text', async () => {
    expect(await failing({ pageSize: '101' })).toEqual(['pageSize']);
    expect(await failing({ pageSize: '0' })).toEqual(['pageSize']);
    expect(await failing({ pageSize: 'many' })).toEqual(['pageSize']);
  });

  it('needs both ends of the sent range, as dates', async () => {
    expect(await failing({ sentFrom: '2026-10-01' })).toEqual([
      'sentFrom',
      'sentTo',
    ]);
    expect(await failing({ sentTo: '2026-10-31' })).toEqual([
      'sentFrom',
      'sentTo',
    ]);
    expect(
      await failing({ sentFrom: '1.10.2026', sentTo: '2026-10-31' }),
    ).toEqual(['sentFrom', 'sentTo']);
  });

  it('refuses a range that ends before it starts and days that do not exist', async () => {
    expect(
      await failing({ sentFrom: '2026-10-31', sentTo: '2026-10-01' }),
    ).toEqual(['sentFrom', 'sentTo']);
    expect(
      await failing({ sentFrom: '2026-13-45', sentTo: '2026-10-31' }),
    ).toEqual(['sentFrom', 'sentTo']);
    expect(
      await failing({ sentFrom: '2026-02-30', sentTo: '2026-03-01' }),
    ).toEqual(['sentFrom', 'sentTo']);
    expect(
      await failing({ sentFrom: '2026-10-05', sentTo: '2026-10-05' }),
    ).toEqual([]);
  });

  it('refuses an unknown status and ids that are not UUIDs', async () => {
    expect(
      await failing({ status: 'WAITING', customerId: '1', orderId: 'x' }),
    ).toEqual(['customerId', 'orderId', 'status']);
  });
});

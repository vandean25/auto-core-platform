import { BadRequestException } from '@nestjs/common';
import { InventoryPatchBodyPipe } from './inventory-patch-body.pipe.js';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto.js';

describe('inventory PATCH body dispatch (AUT-929)', () => {
  // Most cases call the async legacy branch or guarded parser synchronously.
  const pipe = new InventoryPatchBodyPipe();

  it('guarded presence never falls back when expectedRevision is null', async () => {
    await expect(
      pipe.transform(
        { retail_price: 10, expectedRevision: null },
        { type: 'body', metatype: Object },
      ),
    ).rejects.toMatchObject({
      response: { code: 'GUARDED_REQUEST_INVALID' },
    });
  });

  it('guarded presence never falls back when an extra field is present', async () => {
    await expect(
      pipe.transform(
        { retail_price: 10, expectedRevision: 1, sku: 'X' },
        { type: 'body', metatype: Object },
      ),
    ).rejects.toMatchObject({
      response: { code: 'GUARDED_REQUEST_INVALID' },
    });
  });

  it('legacy golden accept: valid full body passes global validation', async () => {
    const raw = {
      sku: 'PART-1',
      name: 'Part',
      cost_price: 5,
      retail_price: 10,
    };
    const body = await pipe.transform(raw, { type: 'body', metatype: Object });
    expect(body).toEqual({
      mode: 'legacy',
      dto: expect.objectContaining({
        sku: 'PART-1',
        name: 'Part',
        cost_price: 5,
        retail_price: 10,
      }),
    });
  });

  it('legacy golden reject: unknown field is forbidden (global pipe)', async () => {
    await expect(
      pipe.transform(
        {
          sku: 'PART-1',
          name: 'Part',
          cost_price: 5,
          retail_price: 10,
          extra_field: 'nope',
        },
        { type: 'body', metatype: Object },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('legacy golden reject: missing sku fails legacy branch only when unguarded', async () => {
    await expect(
      pipe.transform(
        { name: 'Part', cost_price: 1, retail_price: 2 },
        { type: 'body', metatype: Object },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('guarded golden reject: more than two decimal places', async () => {
    await expect(
      pipe.transform(
        { retail_price: 10.123, expectedRevision: 1 },
        { type: 'body', metatype: Object },
      ),
    ).rejects.toMatchObject({
      response: { code: 'GUARDED_REQUEST_INVALID' },
    });
  });
});

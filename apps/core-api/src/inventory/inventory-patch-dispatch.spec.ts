import { BadRequestException } from '@nestjs/common';
import { InventoryPatchBodyPipe } from './inventory-patch-body.pipe.js';
import { createGlobalValidationPipe } from '../common/validation.pipe.js';
import { plainToInstance } from 'class-transformer';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto.js';
import { validateSync } from 'class-validator';

describe('inventory PATCH body dispatch (AUT-929)', () => {
  const pipe = new InventoryPatchBodyPipe();
  const globalPipe = createGlobalValidationPipe();

  it('guarded presence never falls back when expectedRevision is null', () => {
    expect(() =>
      pipe.transform({ retail_price: 10, expectedRevision: null }, { type: 'body', metatype: Object }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'GUARDED_REQUEST_INVALID' }),
      }),
    );
  });

  it('guarded presence never falls back when an extra field is present', () => {
    expect(() =>
      pipe.transform(
        { retail_price: 10, expectedRevision: 1, sku: 'X' },
        { type: 'body', metatype: Object },
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'GUARDED_REQUEST_INVALID' }),
      }),
    );
  });

  it('legacy golden accept: valid full body passes legacy validation', () => {
    const raw = {
      sku: 'PART-1',
      name: 'Part',
      cost_price: 5,
      retail_price: 10,
    };
    const body = pipe.transform(raw, { type: 'body', metatype: Object });
    expect(body).toEqual({ mode: 'legacy', dto: expect.objectContaining(raw) });
    const dto = plainToInstance(UpdateInventoryItemDto, raw);
    expect(validateSync(dto)).toHaveLength(0);
    expect(globalPipe.transform(dto, { type: 'body', metatype: UpdateInventoryItemDto })).toBeDefined();
  });

  it('legacy golden reject: missing sku fails legacy branch only when unguarded', () => {
    expect(() =>
      pipe.transform({ name: 'Part', cost_price: 1, retail_price: 2 }, { type: 'body', metatype: Object }),
    ).toThrow(BadRequestException);
  });

  it('guarded golden reject: more than two decimal places', () => {
    expect(() =>
      pipe.transform(
        { retail_price: 10.123, expectedRevision: 1 },
        { type: 'body', metatype: Object },
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'GUARDED_REQUEST_INVALID' }),
      }),
    );
  });
});

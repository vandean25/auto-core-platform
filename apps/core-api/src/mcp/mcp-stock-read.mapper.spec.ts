import { Prisma } from '@prisma/client';
import {
  binFieldsFromLevels,
  mapInventoryStocksToBinLevels,
  pickPrimaryBin,
} from './mcp-stock-read.mapper.js';

describe('mcp-stock-read.mapper (AUT-428)', () => {
  it('picks the bin with the most on-hand stock', () => {
    const bins = [
      {
        location_id: '00000000-0000-4000-8000-0000000000b2',
        name: 'Shelf B',
        code: 'B-02',
        quantity_on_hand: 2,
        quantity_reserved: 0,
        quantity_available: 2,
      },
      {
        location_id: '00000000-0000-4000-8000-0000000000b1',
        name: 'Shelf A',
        code: 'A-01',
        quantity_on_hand: 5,
        quantity_reserved: 1,
        quantity_available: 4,
      },
    ];

    expect(pickPrimaryBin(bins)?.location_id).toBe(
      '00000000-0000-4000-8000-0000000000b1',
    );
    expect(binFieldsFromLevels(bins)).toEqual({
      bin_id: '00000000-0000-4000-8000-0000000000b1',
      bin_label: 'Shelf A',
    });
  });

  it('groups bin levels per catalog item', () => {
    const byItem = mapInventoryStocksToBinLevels([
      {
        catalog_item_id: 'item-1',
        location_id: 'bin-1',
        quantity_on_hand: new Prisma.Decimal(3),
        quantity_reserved: new Prisma.Decimal(0),
        location: { name: 'Bin 1', code: 'B1' },
      },
      {
        catalog_item_id: 'item-2',
        location_id: 'bin-2',
        quantity_on_hand: new Prisma.Decimal(1),
        quantity_reserved: new Prisma.Decimal(0),
        location: { name: 'Bin 2', code: 'B2' },
      },
    ]);

    expect(byItem.get('item-1')?.[0]).toMatchObject({
      location_id: 'bin-1',
      quantity_on_hand: 3,
      quantity_available: 3,
    });
    expect(byItem.get('item-2')?.[0].location_id).toBe('bin-2');
  });
});

import { Prisma } from '@prisma/client';
import {
  embedCatalogItemForHttp,
  toJsonSafeCatalogItem,
} from './catalog-item-response.mapper.js';

function makeCatalogItem(): Prisma.CatalogItemGetPayload<Record<string, never>> {
  return {
    id: 'cat-1',
    tenant_id: 'tenant-1',
    sku: 'SKU-1',
    name: 'Filter',
    cost_price: null,
    retail_price: new Prisma.Decimal('12.5'),
    unit: 'pcs',
    source_system: null,
    external_article_id: null,
    ean: null,
    oem_numbers: null,
    specs: null,
    superseded_by_id: null,
    brand_id: 1,
    revenue_group_id: null,
    revision: 7n,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('catalog-item-response.mapper embed helpers', () => {
  it('serializes embedded catalog_item revision for JSON responses', () => {
    const item = makeCatalogItem();
    const embedded = embedCatalogItemForHttp({ catalog_item: item, id: 'line-1' });
    expect(JSON.stringify(embedded)).toContain('"revision":7');
    expect(embedded.catalog_item.revision).toBe(7);
  });

  it('toJsonSafeCatalogItem preserves non-revision fields', () => {
    const item = makeCatalogItem();
    const safe = toJsonSafeCatalogItem(item);
    expect(safe.sku).toBe(item.sku);
    expect(safe.revision).toBe(7);
  });
});

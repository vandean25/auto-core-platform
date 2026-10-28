import {
  AuditActorType,
  AuditLogAction,
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import {
  ACTOR_EMAIL,
  JOB_ID,
  TENANT_ID,
  arrangeApply,
  dryRunParams,
  importJobRecord,
  jobRowRecord,
  setupImportHarness,
} from './import.service.spec.support.js';

const SUPPLIER = ImportEntityType.SUPPLIER_PRICE_LIST;
const VENDOR_ID = 'vendor-1';
const SUP_HEADER =
  'Lieferanten-Artikelnummer;EAN;Beschreibung;Marke;Einkaufspreis;UVP;Einheit';
const SUP_MAPPING = {
  supplier_article_no: 'Lieferanten-Artikelnummer',
  ean: 'EAN',
  description: 'Beschreibung',
  brand: 'Marke',
  cost_price: 'Einkaufspreis',
  rrp: 'UVP',
  unit: 'Einheit',
};
const MARGIN_50_ROUND_90 = {
  id: 'rule-1',
  priority: 1,
  brand_id: null,
  revenue_group_id: null,
  cost_min: null,
  cost_max: null,
  markup_percent: 50,
  use_supplier_rrp: false,
  rounding: 'ROUND_90',
  is_active: true,
};

function supplierCsv(...rows: string[]): string {
  return [SUP_HEADER, ...rows].join('\n') + '\n';
}

function supRow(
  article: string,
  cost: string,
  extra: {
    ean?: string;
    description?: string;
    brand?: string;
    rrp?: string;
    unit?: string;
  } = {},
): string {
  const {
    ean = '',
    description = 'Teil',
    brand = '',
    rrp = '',
    unit = '',
  } = extra;
  return [article, ean, description, brand, cost, rrp, unit].join(';');
}

function catalogItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    sku: 'ART-1',
    name: 'Bremsscheibe',
    cost_price: 50,
    retail_price: 80,
    ean: null,
    brand_id: null,
    revenue_group_id: null,
    ...overrides,
  };
}

describe('ImportService supplier price list (characterization)', () => {
  const h = setupImportHarness();

  function arrangeVendor(
    vendor = { id: VENDOR_ID, name: 'Autoteile Partner' },
  ) {
    h.prisma.vendor.findFirst.mockResolvedValue(vendor);
    h.prisma.vendor.findMany.mockResolvedValue([vendor]);
  }

  beforeEach(() => {
    arrangeVendor();
  });

  function dryRun(csv: string, optionsJson = {}, sourceSystem = VENDOR_ID) {
    return h.service.createDryRunFromUpload(
      dryRunParams(SUPPLIER, csv, {
        sourceSystem,
        mappingJson: SUP_MAPPING,
        optionsJson,
      }),
    );
  }

  function lastCreatedJob() {
    return h.prisma.importJob.create.mock.calls.at(-1)![0].data;
  }

  describe('vendor resolution at upload', () => {
    it('prefers an explicit vendor_id over the source system', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue({
        id: 'vendor-9',
        name: 'Explizit',
      });

      await dryRun(
        supplierCsv(supRow('ART-1', '10')),
        { vendor_id: ' vendor-9 ' },
        'other',
      );

      expect(h.prisma.vendor.findFirst).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, id: 'vendor-9' },
        select: { id: true, name: true },
      });
      expect(lastCreatedJob().options_json.vendor_id).toBe('vendor-9');
    });

    it('uses the source system as a vendor id when that id exists', async () => {
      await dryRun(supplierCsv(supRow('ART-1', '10')));

      expect(h.prisma.vendor.findFirst).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, id: VENDOR_ID },
        select: { id: true, name: true },
      });
      expect(h.prisma.vendor.findMany).not.toHaveBeenCalled();
      expect(lastCreatedJob().options_json.vendor_id).toBe(VENDOR_ID);
    });

    it('resolves a single vendor by name or account number', async () => {
      // The upload resolves the name, and the dry run resolves the stored id again.
      h.prisma.vendor.findFirst.mockImplementation(async ({ where }: any) =>
        where.id === 'vendor-2'
          ? { id: 'vendor-2', name: 'Autoteile Süd' }
          : null,
      );
      h.prisma.vendor.findMany.mockResolvedValue([
        { id: 'vendor-2', name: 'Autoteile Süd' },
      ]);

      await dryRun(supplierCsv(supRow('ART-1', '10')), {}, 'Autoteile Süd');

      expect(h.prisma.vendor.findMany).toHaveBeenCalledWith({
        where: {
          tenant_id: TENANT_ID,
          OR: [{ name: 'Autoteile Süd' }, { account_number: 'Autoteile Süd' }],
        },
        select: { id: true, name: true },
      });
      expect(lastCreatedJob().options_json.vendor_id).toBe('vendor-2');
    });

    it('rejects an ambiguous name with AMBIGUOUS_VENDOR', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue(null);
      h.prisma.vendor.findMany.mockResolvedValue([
        { id: 'vendor-2', name: 'Autoteile' },
        { id: 'vendor-3', name: 'Autoteile' },
      ]);

      await expect(
        dryRun(supplierCsv(supRow('ART-1', '10')), {}, 'Autoteile'),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: IMPORT_ERROR_CODES.AMBIGUOUS_VENDOR,
          message:
            "Mehrere Lieferanten mit dem Namen 'Autoteile' gefunden. Bitte Lieferanten-ID angeben.",
        },
      });
    });

    it('rejects an unknown explicit vendor_id with a German message', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue(null);

      await expect(
        dryRun(supplierCsv(supRow('ART-1', '10')), { vendor_id: 'vendor-x' }),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: IMPORT_ERROR_CODES.SUPPLIER_VENDOR_REQUIRED,
          message: "Lieferant mit ID 'vendor-x' nicht gefunden",
        },
      });
    });

    it('rejects an unknown source system with a German message', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue(null);
      h.prisma.vendor.findMany.mockResolvedValue([]);

      await expect(
        dryRun(supplierCsv(supRow('ART-1', '10')), {}, 'Unbekannt'),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: IMPORT_ERROR_CODES.SUPPLIER_VENDOR_REQUIRED,
          message: "Lieferant 'Unbekannt' nicht gefunden",
        },
      });
    });

    it('rejects a blank source system when no vendor id is given, before any lookup', async () => {
      await expect(
        dryRun(supplierCsv(supRow('ART-1', '10')), {}, '   '),
      ).rejects.toMatchObject({
        status: 400,
        response: {
          code: IMPORT_ERROR_CODES.SUPPLIER_VENDOR_REQUIRED,
          message: 'Valid vendor is required for supplier price list import',
        },
      });
      expect(h.prisma.vendor.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('dry-run row rules', () => {
    it('reports a missing article number and description together as row errors', async () => {
      await dryRun(supplierCsv(supRow('', '10', { description: '' })));

      const [row] = lastCreatedJob().rows.create;
      expect(row).toMatchObject({
        row_no: 1,
        external_id: '',
        action: ImportRowAction.ERROR,
        normalized_json: Prisma.JsonNull,
        errors_json: [
          {
            code: IMPORT_ERROR_CODES.SUPPLIER_ARTICLE_NO_REQUIRED,
            message: 'Lieferanten-Artikelnummer ist erforderlich',
            field: 'supplier_article_no',
          },
          {
            code: IMPORT_ERROR_CODES.DESCRIPTION_REQUIRED,
            message: 'Beschreibung ist erforderlich',
            field: 'description',
          },
        ],
      });
    });

    it.each([
      ['a non-numeric cost', 'abc'],
      ['a zero cost', '0'],
    ])(
      'rejects %s with INVALID_COST_PRICE and the article number as external id',
      async (_label, cost) => {
        await dryRun(supplierCsv(supRow('ART-1', cost)));

        const [row] = lastCreatedJob().rows.create;
        expect(row).toMatchObject({
          external_id: 'ART-1',
          action: ImportRowAction.ERROR,
          errors_json: [
            {
              code: IMPORT_ERROR_CODES.INVALID_COST_PRICE,
              message:
                'Gültiger Einkaufspreis ist erforderlich (muss positiv sein)',
              field: 'cost_price',
            },
          ],
        });
      },
    );

    it('matches catalog items by EAN, then vendor article number, then SKU', async () => {
      h.prisma.catalogItem.findMany.mockResolvedValue([
        catalogItem({ id: 'item-ean', sku: 'SKU-A', ean: '4012345678901' }),
        catalogItem({ id: 'item-sku', sku: 'ART-9' }),
      ]);
      h.prisma.vendorArticle.findMany.mockResolvedValue([
        {
          vendor_article_no: 'ART-7',
          catalog_item_id: 'item-va',
          catalog_item: catalogItem({ id: 'item-va', sku: 'SKU-V' }),
        },
      ]);

      await dryRun(
        supplierCsv(
          supRow('ART-X', '10', { ean: '4012345678901' }),
          supRow('ART-7', '10'),
          supRow('art-9', '10'),
        ),
      );

      const rows = lastCreatedJob().rows.create;
      expect(
        rows.map((row: { entity_id: string | null }) => row.entity_id),
      ).toEqual(['item-ean', 'item-va', 'item-sku']);
      expect(
        rows.map(
          (row: { normalized_json: { match_method: string } }) =>
            row.normalized_json.match_method,
        ),
      ).toEqual(['EAN', 'VENDOR_ARTICLE_NO', 'SKU']);
    });

    it('skips unknown articles with a warning unless create_new_catalog_items is set', async () => {
      await dryRun(supplierCsv(supRow('NEW-1', '12', { description: 'Neu' })));

      expect(lastCreatedJob().rows.create[0]).toMatchObject({
        action: ImportRowAction.SKIP,
        entity_id: null,
        warnings_json: [
          {
            code: IMPORT_ERROR_CODES.ARTICLE_NOT_FOUND,
            message:
              'Artikel nicht im Katalog gefunden und Neuanlage ist deaktiviert',
            field: 'supplier_article_no',
          },
        ],
      });

      h.prisma.importJob.create.mockClear();
      await dryRun(supplierCsv(supRow('NEW-1', '12', { description: 'Neu' })), {
        create_new_catalog_items: true,
      });

      expect(lastCreatedJob().rows.create[0]).toMatchObject({
        action: ImportRowAction.CREATE,
        warnings_json: Prisma.JsonNull,
      });
    });

    it('skips a matched item whose prices are unchanged and updates one whose cost moved', async () => {
      h.prisma.catalogItem.findMany.mockResolvedValue([
        catalogItem({
          id: 'item-1',
          sku: 'ART-1',
          cost_price: 50,
          retail_price: 80,
        }),
        catalogItem({
          id: 'item-2',
          sku: 'ART-2',
          cost_price: 50,
          retail_price: 80,
        }),
      ]);

      await dryRun(
        supplierCsv(supRow('ART-1', '50,00'), supRow('ART-2', '60')),
      );

      const [same, changed] = lastCreatedJob().rows.create;
      expect(same).toMatchObject({
        action: ImportRowAction.SKIP,
        entity_id: 'item-1',
      });
      expect(changed).toMatchObject({
        action: ImportRowAction.UPDATE,
        entity_id: 'item-2',
        normalized_json: expect.objectContaining({
          cost_price: 60,
          retail_price: 80,
        }),
      });
    });

    it('computes the retail price from the matching margin rule with its rounding', async () => {
      h.prisma.marginRule.findMany.mockResolvedValue([MARGIN_50_ROUND_90]);

      await dryRun(supplierCsv(supRow('ART-5', '10')), {
        create_new_catalog_items: true,
      });

      expect(lastCreatedJob().rows.create[0]).toMatchObject({
        action: ImportRowAction.CREATE,
        normalized_json: expect.objectContaining({
          cost_price: 10,
          retail_price: 15.9,
        }),
      });
      expect(h.prisma.marginRule.findMany).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, is_active: true },
        orderBy: { priority: 'asc' },
      });
    });

    it('warns and keeps the cost as retail when a supplier-RRP rule has no UVP and no markup', async () => {
      h.prisma.marginRule.findMany.mockResolvedValue([
        {
          ...MARGIN_50_ROUND_90,
          markup_percent: null,
          use_supplier_rrp: true,
          rounding: 'NONE',
        },
      ]);

      await dryRun(supplierCsv(supRow('ART-6', '10')), {
        create_new_catalog_items: true,
      });

      expect(lastCreatedJob().rows.create[0]).toMatchObject({
        action: ImportRowAction.CREATE,
        normalized_json: expect.objectContaining({ retail_price: 10 }),
        warnings_json: [
          {
            code: IMPORT_ERROR_CODES.RRP_MISSING_FOR_MARGIN_RULE,
            message:
              'Keine UVP vorhanden und kein Aufschlag definiert; Verkaufspreis wird auf den Einkaufspreis gesetzt',
            field: 'rrp',
          },
        ],
      });
    });

    it('flags a price jump above the finance threshold and lets the option override it', async () => {
      h.prisma.financeSettings.findFirst.mockResolvedValue({
        price_jump_threshold_percent: 20,
      });
      h.prisma.catalogItem.findMany.mockResolvedValue([
        catalogItem({
          id: 'item-1',
          sku: 'ART-1',
          cost_price: 20,
          retail_price: 40,
        }),
      ]);
      const csv = supplierCsv(supRow('ART-1', '50'));

      await dryRun(csv);
      expect(lastCreatedJob().rows.create[0]).toMatchObject({
        action: ImportRowAction.UPDATE,
        normalized_json: expect.objectContaining({
          price_jump_flagged: true,
          cost_change_percent: 150,
        }),
        warnings_json: [
          {
            code: IMPORT_ERROR_CODES.PRICE_JUMP_EXCEEDED,
            message: 'Preissprung überschreitet Schwellenwert von 20%',
            field: 'cost_price',
          },
        ],
      });

      h.prisma.importJob.create.mockClear();
      await dryRun(csv, { price_jump_threshold_percent: 200 });
      expect(lastCreatedJob().rows.create[0]).toMatchObject({
        normalized_json: expect.objectContaining({ price_jump_flagged: false }),
        warnings_json: Prisma.JsonNull,
      });
    });

    it('uses a 20 percent threshold when the tenant has no finance settings', async () => {
      h.prisma.financeSettings.findFirst.mockResolvedValue(null);
      h.prisma.catalogItem.findMany.mockResolvedValue([
        catalogItem({
          id: 'item-1',
          sku: 'ART-1',
          cost_price: 20,
          retail_price: 40,
        }),
      ]);

      // 20 -> 25 is a 25 percent move, above the 20 percent default.
      await dryRun(supplierCsv(supRow('ART-1', '25')));

      expect(lastCreatedJob().rows.create[0]).toMatchObject({
        normalized_json: expect.objectContaining({ price_jump_flagged: true }),
        warnings_json: [
          expect.objectContaining({
            code: IMPORT_ERROR_CODES.PRICE_JUMP_EXCEEDED,
            message: 'Preissprung überschreitet Schwellenwert von 20%',
          }),
        ],
      });
    });

    it('rejects a repeated article number in the file against the first row', async () => {
      await dryRun(supplierCsv(supRow('ART-1', '10'), supRow('ART-1', '11')), {
        create_new_catalog_items: true,
      });

      const [, second] = lastCreatedJob().rows.create;
      expect(second).toMatchObject({
        row_no: 2,
        external_id: 'ART-1',
        action: ImportRowAction.ERROR,
        errors_json: [
          {
            code: IMPORT_ERROR_CODES.DUPLICATE_ARTICLE_NO_IN_FILE,
            message: 'Doppelte Artikelnummer in Datei (zuerst in Zeile 1)',
            field: 'supplier_article_no',
          },
        ],
      });
    });

    it('maps brand names to brand ids case-insensitively and keeps the matched item brand otherwise', async () => {
      h.prisma.brand.findMany.mockResolvedValue([
        { id: 7, name: 'Bosch', normalized_name: 'BOSCH' },
      ]);
      h.prisma.catalogItem.findMany.mockResolvedValue([
        catalogItem({ id: 'item-2', sku: 'ART-2', brand_id: 3 }),
      ]);

      await dryRun(
        supplierCsv(
          supRow('ART-3', '10', { brand: 'bosch' }),
          supRow('ART-2', '10', { brand: 'Unbekannt' }),
          supRow('ART-4', '10'),
        ),
        { create_new_catalog_items: true },
      );

      const brandIds = lastCreatedJob().rows.create.map(
        (row: { normalized_json: { brand_id: number | null } }) =>
          row.normalized_json.brand_id,
      );
      expect(brandIds).toEqual([7, 3, null]);
    });

    it('stores dry-run totals that include flagged price jumps', async () => {
      h.prisma.catalogItem.findMany.mockResolvedValue([
        catalogItem({
          id: 'item-1',
          sku: 'ART-1',
          cost_price: 20,
          retail_price: 40,
        }),
      ]);

      await dryRun(
        supplierCsv(supRow('ART-1', '50'), supRow('ART-NEW', '12')),
        {
          create_new_catalog_items: true,
        },
      );

      expect(lastCreatedJob().totals_json).toEqual({
        rows: 2,
        create: 1,
        update: 1,
        skip: 0,
        error: 0,
        flagged_jumps: 1,
      });
    });
  });

  describe('apply', () => {
    const SUP_JOB = importJobRecord({
      entity_type: SUPPLIER,
      source_system: VENDOR_ID,
      options_json: { vendor_id: VENDOR_ID },
    });

    beforeEach(() => {
      h.prisma.vendorArticle.findFirst.mockResolvedValue(null);
      h.prisma.vendorArticle.upsert.mockResolvedValue({});
      h.prisma.catalogPriceHistory.create.mockResolvedValue({});
      h.prisma.catalogItem.create.mockResolvedValue({
        id: 'item-new',
        sku: 'ART-200',
      });
    });

    it('creates a catalog item with defaults, a price history row and links the import row', async () => {
      arrangeApply(h, SUP_JOB, [
        jobRowRecord({
          row_no: 1,
          action: ImportRowAction.CREATE,
          external_id: 'ART-200',
          normalized_json: {
            supplier_article_no: 'ART-200',
            description: 'Ölfilter',
            cost_price: 15,
            retail_price: 25,
            rrp: 30,
            unit: '',
            ean: null,
            brand_id: null,
          },
        }),
      ]);

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.catalogItem.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          sku: 'ART-200',
          name: 'Ölfilter',
          cost_price: 15,
          retail_price: 25,
          unit: 'pcs',
          brand_id: null,
          ean: null,
          source_system: VENDOR_ID,
        },
      });
      expect(h.prisma.catalogPriceHistory.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          catalog_item_id: 'item-new',
          old_cost: null,
          new_cost: 15,
          old_retail: null,
          new_retail: 25,
          import_job_id: JOB_ID,
        },
      });
      expect(h.prisma.vendorArticle.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            vendor_id: VENDOR_ID,
            catalog_item_id: 'item-new',
            vendor_article_no: 'ART-200',
            last_cost: 15,
            last_rrp: 30,
          }),
        }),
      );
      expect(h.prisma.importJobRow.update).toHaveBeenCalledWith({
        where: {
          tenant_id_import_job_id_row_no: {
            tenant_id: TENANT_ID,
            import_job_id: JOB_ID,
            row_no: 1,
          },
        },
        data: { entity_id: 'item-new' },
      });
    });

    it('refuses to overwrite a cost that changed in the catalog after the preview', async () => {
      h.prisma.catalogItem.findFirst.mockResolvedValue({
        id: 'item-1',
        cost_price: 60,
        retail_price: 80,
      });
      arrangeApply(h, SUP_JOB, [
        jobRowRecord({
          row_no: 1,
          action: ImportRowAction.UPDATE,
          entity_id: 'item-1',
          external_id: 'ART-1',
          normalized_json: {
            supplier_article_no: 'ART-1',
            cost_price: 100,
            retail_price: 80,
            old_cost: 50,
            old_retail: 80,
          },
        }),
      ]);

      const result = await h.service.applyJob(JOB_ID);

      expect(h.prisma.catalogItem.update).not.toHaveBeenCalled();
      expect(h.prisma.importJobRow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            action: ImportRowAction.ERROR,
            errors_json: [
              {
                code: IMPORT_ERROR_CODES.ROW_STALE,
                message:
                  'Einkaufspreis wurde seit der Vorschau im Katalog geändert',
              },
            ],
          },
        }),
      );
      expect(result).toMatchObject({
        status: ImportJobStatus.APPLIED,
        totals: { error: 1 },
      });
    });

    it('refuses to overwrite a retail price that changed in the catalog after the preview', async () => {
      h.prisma.catalogItem.findFirst.mockResolvedValue({
        id: 'item-1',
        cost_price: 50,
        retail_price: 90,
      });
      arrangeApply(h, SUP_JOB, [
        jobRowRecord({
          row_no: 1,
          action: ImportRowAction.UPDATE,
          entity_id: 'item-1',
          external_id: 'ART-1',
          normalized_json: {
            supplier_article_no: 'ART-1',
            cost_price: 55,
            retail_price: 150,
            old_cost: 50,
            old_retail: 80,
          },
        }),
      ]);

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.importJobRow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            errors_json: [
              expect.objectContaining({
                code: IMPORT_ERROR_CODES.ROW_STALE,
                message:
                  'Verkaufspreis wurde seit der Vorschau im Katalog geändert',
              }),
            ],
          }),
        }),
      );
    });

    it('marks UPDATE rows without an article id or with a deleted item as ROW_STALE', async () => {
      h.prisma.catalogItem.findFirst.mockResolvedValue(null);
      arrangeApply(h, SUP_JOB, [
        jobRowRecord({
          row_no: 1,
          action: ImportRowAction.UPDATE,
          entity_id: null,
          external_id: 'ART-1',
          normalized_json: {
            supplier_article_no: 'ART-1',
            cost_price: 10,
            retail_price: 20,
          },
        }),
        jobRowRecord({
          row_no: 2,
          action: ImportRowAction.UPDATE,
          entity_id: 'item-gone',
          external_id: 'ART-2',
          normalized_json: {
            supplier_article_no: 'ART-2',
            cost_price: 10,
            retail_price: 20,
          },
        }),
      ]);

      await h.service.applyJob(JOB_ID);

      const messages = h.prisma.importJobRow.update.mock.calls.map(
        ([args]: [{ data: { errors_json: Array<{ message: string }> } }]) =>
          args.data.errors_json[0].message,
      );
      expect(messages).toEqual([
        'Artikel-ID fehlt',
        'Artikel wurde zwischenzeitlich gelöscht',
      ]);
    });

    it('reuses the stored vendor article spelling when the article number differs only by case', async () => {
      h.prisma.vendorArticle.findFirst.mockResolvedValue({
        vendor_article_no: 'Art-100',
      });
      arrangeApply(h, SUP_JOB, [
        jobRowRecord({
          row_no: 1,
          action: ImportRowAction.CREATE,
          external_id: 'ART-100',
          normalized_json: {
            supplier_article_no: 'ART-100',
            description: 'Teil',
            cost_price: 5,
            retail_price: 9,
          },
        }),
      ]);

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.vendorArticle.upsert).toHaveBeenCalledWith({
        where: {
          tenant_id_vendor_id_vendor_article_no: {
            tenant_id: TENANT_ID,
            vendor_id: VENDOR_ID,
            vendor_article_no: 'Art-100',
          },
        },
        create: expect.objectContaining({ vendor_article_no: 'Art-100' }),
        update: expect.objectContaining({ catalog_item_id: 'item-new' }),
      });
    });

    it('writes the applied audit entry and the effective options in the same transaction as APPLIED', async () => {
      arrangeApply(h, SUP_JOB, []);

      await h.service.applyJob(JOB_ID, { accept_all_price_jumps: true });

      expect(h.prisma.importJob.update).toHaveBeenCalledWith({
        where: { id: JOB_ID },
        data: {
          status: ImportJobStatus.APPLIED,
          appliedAt: expect.any(Date),
          totals_json: { rows: 0, create: 0, update: 0, skip: 0, error: 0 },
          options_json: { vendor_id: VENDOR_ID, accept_all_price_jumps: true },
        },
      });
      expect(h.prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'ImportJob',
          entity_id: JOB_ID,
          action: AuditLogAction.UPDATE,
          actor_user_id: 'user-db-id',
          actor_email: ACTOR_EMAIL,
          actor_role: 'ADMIN',
          actor_type: AuditActorType.USER,
          source: 'import',
          after: {
            event: 'import_job.applied',
            importJobId: JOB_ID,
            totals: { rows: 0, create: 0, update: 0, skip: 0, error: 0 },
          },
        },
      });
    });

    function flaggedRows() {
      return [1, 2].map((rowNo) =>
        jobRowRecord({
          row_no: rowNo,
          action: ImportRowAction.UPDATE,
          entity_id: `item-${rowNo}`,
          external_id: `ART-${rowNo}`,
          normalized_json: {
            supplier_article_no: `ART-${rowNo}`,
            price_jump_flagged: true,
            cost_price: 100,
            retail_price: 150,
          },
        }),
      );
    }

    it('ignores accepted_row_numbers stored on the job when checking price-jump acceptance', async () => {
      arrangeApply(
        h,
        importJobRecord({
          ...SUP_JOB,
          options_json: { vendor_id: VENDOR_ID, accepted_row_numbers: [1] },
        }),
        flaggedRows(),
      );
      h.prisma.catalogItem.findFirst.mockResolvedValue({
        id: 'item-x',
        cost_price: 50,
        retail_price: 80,
      });

      // Row 1 is accepted only on the job, so the request must accept it again.
      await expect(
        h.service.applyJob(JOB_ID, { accepted_row_numbers: [2] }),
      ).rejects.toMatchObject({
        status: 400,
        response: { code: IMPORT_ERROR_CODES.PRICE_JUMP_REQUIRES_ACCEPTANCE },
      });
      expect(h.prisma.importJob.updateMany).not.toHaveBeenCalled();
    });

    it('persists accepted_row_numbers from the job and the request concatenated, without de-duplication', async () => {
      arrangeApply(
        h,
        importJobRecord({
          ...SUP_JOB,
          options_json: { vendor_id: VENDOR_ID, accepted_row_numbers: [1] },
        }),
        flaggedRows(),
      );
      h.prisma.catalogItem.findFirst.mockResolvedValue({
        id: 'item-x',
        cost_price: 50,
        retail_price: 80,
      });

      const result = await h.service.applyJob(JOB_ID, {
        accepted_row_numbers: [1, 2],
      });

      expect(result.status).toBe(ImportJobStatus.APPLIED);
      expect(h.prisma.importJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            options_json: expect.objectContaining({
              accepted_row_numbers: [1, 1, 2],
            }),
          }),
        }),
      );
    });

    it('checks price-jump acceptance before resolving the vendor and before taking the status lock', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue(null);
      arrangeApply(h, SUP_JOB, [
        jobRowRecord({
          row_no: 1,
          action: ImportRowAction.UPDATE,
          entity_id: 'item-1',
          external_id: 'ART-1',
          normalized_json: {
            supplier_article_no: 'ART-1',
            price_jump_flagged: true,
          },
        }),
      ]);

      await expect(h.service.applyJob(JOB_ID)).rejects.toMatchObject({
        status: 400,
        response: { code: IMPORT_ERROR_CODES.PRICE_JUMP_REQUIRES_ACCEPTANCE },
      });
      expect(h.prisma.vendor.findFirst).not.toHaveBeenCalled();
      expect(h.prisma.importJob.updateMany).not.toHaveBeenCalled();
    });

    it('resolves the vendor again at apply and stops before the status lock when it is gone', async () => {
      h.prisma.vendor.findFirst.mockResolvedValue(null);
      arrangeApply(h, SUP_JOB, []);

      await expect(h.service.applyJob(JOB_ID)).rejects.toMatchObject({
        status: 400,
        response: {
          code: IMPORT_ERROR_CODES.SUPPLIER_VENDOR_REQUIRED,
          message: `Lieferant mit ID '${VENDOR_ID}' nicht gefunden`,
        },
      });
      expect(h.prisma.importJob.updateMany).not.toHaveBeenCalled();
    });

    it('applies rows in chunks of 50, one transaction per chunk, then one for the applied bookkeeping', async () => {
      const rows = Array.from({ length: 120 }, (_, index) =>
        jobRowRecord({
          row_no: index + 1,
          action: ImportRowAction.SKIP,
          external_id: `ART-${index + 1}`,
        }),
      );
      arrangeApply(h, SUP_JOB, rows);

      const result = await h.service.applyJob(JOB_ID);

      expect(h.prisma.$transaction).toHaveBeenCalledTimes(5);
      expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 30000,
        maxWait: 10000,
      });
      expect(result.totals).toEqual({
        rows: 120,
        create: 0,
        update: 0,
        skip: 120,
        error: 0,
      });
    });

    it('counts SKIP and ERROR rows without writing anything for them', async () => {
      arrangeApply(h, SUP_JOB, [
        jobRowRecord({
          row_no: 1,
          action: ImportRowAction.SKIP,
          external_id: 'ART-1',
        }),
        jobRowRecord({
          row_no: 2,
          action: ImportRowAction.ERROR,
          external_id: 'ART-2',
        }),
      ]);

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.catalogItem.create).not.toHaveBeenCalled();
      expect(h.prisma.catalogItem.update).not.toHaveBeenCalled();
      expect(h.prisma.vendorArticle.upsert).not.toHaveBeenCalled();
      expect(h.prisma.catalogPriceHistory.create).not.toHaveBeenCalled();
      expect(h.prisma.importJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totals_json: { rows: 2, create: 0, update: 0, skip: 1, error: 1 },
          }),
        }),
      );
    });
  });
});

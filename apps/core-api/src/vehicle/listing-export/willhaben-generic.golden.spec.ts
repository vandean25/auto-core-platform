import { willhabenGenericGoldenInput } from './fixtures/willhaben-generic-golden.fixture.js';
import { sha256Buffer } from './listing-export-zip.js';
import { decodeWillhabenCsv } from './willhaben-generic-csv.util.js';
import {
  WILLHABEN_GENERIC_CSV_FILENAME,
  WILLHABEN_GENERIC_MAX_IMAGES,
} from './willhaben-generic-format.constants.js';
import {
  willhabenGenericColumnIndex,
  WILLHABEN_GENERIC_CSV_COLUMNS,
  WILLHABEN_GENERIC_FIELD_COUNT,
} from './willhaben-generic-layout.manifest.js';
import {
  buildWillhabenGenericCsvRows,
  serializeWillhabenGenericListing,
  willhabenGenericListingSerializer,
} from './willhaben-generic.serializer.js';

function listZipEntryNames(zipBytes: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= zipBytes.length) {
    const signature = zipBytes.subarray(offset, offset + 4).toString('ascii');
    if (signature !== 'PK\x03\x04') {
      break;
    }
    const nameLength = zipBytes.readUInt16LE(offset + 26);
    const extraLength = zipBytes.readUInt16LE(offset + 28);
    const name = zipBytes
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString('utf8');
    const compressedSize = zipBytes.readUInt32LE(offset + 18);
    names.push(name);
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

function cell(
  row: string[],
  column: (typeof WILLHABEN_GENERIC_CSV_COLUMNS)[number],
): string {
  return row[willhabenGenericColumnIndex(column)];
}

describe('willhaben-generic golden export', () => {
  it('pins the generic header row, field placement, quoting and encoding', () => {
    const rows = buildWillhabenGenericCsvRows(willhabenGenericGoldenInput);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([...WILLHABEN_GENERIC_CSV_COLUMNS]);
    expect(rows[1]).toHaveLength(WILLHABEN_GENERIC_FIELD_COUNT);

    const dataRow = rows[1];
    expect(cell(dataRow, 'listing_ref')).toBe(
      willhabenGenericGoldenInput.listingRef,
    );
    expect(cell(dataRow, 'title')).toBe('Example used-car listing');
    expect(cell(dataRow, 'description')).toBe(
      'Generic export with 17" Felgen and umlauts (Größe).\nSemicolon; test.',
    );
    expect(cell(dataRow, 'category')).toBe('');
    expect(cell(dataRow, 'price_gross_eur')).toBe('9750.00');
    expect(cell(dataRow, 'vat_display')).toBe('MARGIN');
    expect(cell(dataRow, 'make')).toBe('Example Motors');
    expect(cell(dataRow, 'model')).toBe('Generic 1.4 TDI');
    expect(cell(dataRow, 'model_year')).toBe('2020');
    expect(cell(dataRow, 'first_registration')).toBe('2020-02-17');
    expect(cell(dataRow, 'mileage_km')).toBe('48500');
    expect(cell(dataRow, 'fuel')).toBe('Diesel');
    expect(cell(dataRow, 'power_kw')).toBe('110');
    expect(cell(dataRow, 'color')).toBe('Weiß metallic');
    expect(cell(dataRow, 'co2_wltp_g_km')).toBe('118');
    expect(cell(dataRow, 'co2_nedc_g_km')).toBe('');
    expect(cell(dataRow, 'emission_class')).toBe('Euro 6d');
    expect(cell(dataRow, 'damage_free')).toBe('1');
    expect(cell(dataRow, 'metallic')).toBe('0');
    expect(cell(dataRow, 'guarantee')).toBe('');
    expect(cell(dataRow, 'jahreswagen')).toBe('0');
    expect(cell(dataRow, 'recommendation')).toBe('');
    expect(cell(dataRow, 'demo_vehicle')).toBe('0');
    expect(cell(dataRow, 'equipment_codes')).toBe('ABS,PARKING_CAMERA');
    expect(cell(dataRow, 'equipment_free_text')).toBe(
      'Allwetterreifen\nNebelscheinwerfer (not fitted)',
    );
    expect(cell(dataRow, 'image_count')).toBe('2');
    expect(cell(dataRow, 'image_filenames')).toBe(
      'Lfedcba9876543210fedcba9876543210_01.jpg,Lfedcba9876543210fedcba9876543210_02.jpg',
    );

    const result = serializeWillhabenGenericListing(
      willhabenGenericGoldenInput,
    );
    const csvText = decodeWillhabenCsv(result.csvBytes);
    expect(csvText).toContain('17"" Felgen');
    expect(csvText).toContain('Größe');
    expect(csvText).toContain('Semicolon; test.');
    expect(csvText.endsWith('\n')).toBe(true);
    expect(result.files[0].sha256).toBe(
      '9321bf8b496a559d0e8b0f2a3417c14ff648e9a76c0ea451f0133703c38c37e5',
    );
    expect(result.sha256).toBe(
      'd34271a24860bae697b9b7b5f3fd75e07ada3c5203e1be8e4040c50b643ac74d',
    );
  });

  it('keeps in-field line breaks inside quoted fields per RFC 4180', () => {
    const result = serializeWillhabenGenericListing(
      willhabenGenericGoldenInput,
    );
    const csvText = decodeWillhabenCsv(result.csvBytes);
    expect(csvText).toContain(
      'Generic export with 17"" Felgen and umlauts (Größe).\nSemicolon; test.',
    );
    expect(csvText).toContain(
      'Allwetterreifen\nNebelscheinwerfer (not fitted)',
    );
    expect(csvText.split('\n')).toHaveLength(5);
    expect(result.rowCount).toBe(1);
  });

  it('orders ZIP entries CSV, images by sequence, then manifest', () => {
    const result = serializeWillhabenGenericListing(
      willhabenGenericGoldenInput,
    );
    const entryNames = listZipEntryNames(result.zipBytes);
    expect(entryNames).toEqual([
      WILLHABEN_GENERIC_CSV_FILENAME,
      'Lfedcba9876543210fedcba9876543210_01.jpg',
      'Lfedcba9876543210fedcba9876543210_02.jpg',
      'manifest.json',
    ]);
    expect(result.files[1].sha256).toBe(
      sha256Buffer(willhabenGenericGoldenInput.images[0].bytes),
    );
  });

  it('flags missing listing ref, make/model, invalid price and too many images', () => {
    const issues = willhabenGenericListingSerializer.validate({
      ...willhabenGenericGoldenInput,
      listingRef: '  ',
      vehicle: {
        ...willhabenGenericGoldenInput.vehicle,
        make: ' ',
        model: '',
      },
      listing: {
        ...willhabenGenericGoldenInput.listing,
        price_gross_eur: '-5.00',
      },
      images: Array.from(
        { length: WILLHABEN_GENERIC_MAX_IMAGES + 1 },
        (_, index) => ({
          sequence: index + 1,
          filename: `Lfedcba9876543210fedcba9876543210_${String(index + 1).padStart(2, '0')}.jpg`,
          bytes: Buffer.from('synthetic-jpeg-bytes'),
          content_sha256:
            'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        }),
      ),
    });

    expect(issues).toEqual([
      {
        field: 'listing_ref',
        code: 'LISTING_REF_REQUIRED',
        message: 'Listing reference is required for willhaben generic export.',
      },
      {
        field: 'vehicle.make_model',
        code: 'LISTING_VEHICLE_MAKE_MODEL_REQUIRED',
        message: 'Make and model are required for willhaben generic export.',
      },
      {
        field: 'listing.price_gross_eur',
        code: 'LISTING_PRICE_GROSS_INVALID',
        message:
          'Gross price must be a positive number for willhaben generic export.',
      },
      {
        field: 'images',
        code: 'LISTING_IMAGES_MAX_EXCEEDED',
        message: 'willhaben generic export allows at most 25 images.',
      },
    ]);
  });

  it('does not require export assertions (empty means unknown)', () => {
    const issues = willhabenGenericListingSerializer.validate({
      ...willhabenGenericGoldenInput,
      exportAssertions: {
        damage_free: null,
        metallic: null,
        guarantee: null,
        jahreswagen: null,
        recommendation: null,
        demo_vehicle: null,
      },
    });
    expect(issues).toEqual([]);
  });
});

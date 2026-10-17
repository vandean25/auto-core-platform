import { willhabenGenericGoldenInput } from './fixtures/willhaben-generic-golden.fixture.js';
import { sha256Buffer } from './listing-export-zip.js';
import {
  decodeWillhabenCsv,
  encodeWillhabenCsv,
} from './willhaben-generic-csv.util.js';
import {
  WILLHABEN_GENERIC_CSV_BOM,
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
  it('pins the contract header, field placement, quoting and encoding', () => {
    const rows = buildWillhabenGenericCsvRows(willhabenGenericGoldenInput);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([...WILLHABEN_GENERIC_CSV_COLUMNS]);
    expect(rows[1]).toHaveLength(WILLHABEN_GENERIC_FIELD_COUNT);

    const dataRow = rows[1];
    expect(cell(dataRow, 'listing_ref')).toBe(
      willhabenGenericGoldenInput.listingRef,
    );
    expect(cell(dataRow, 'action')).toBe('UPSERT');
    expect(cell(dataRow, 'title')).toBe('Example used-car listing');
    expect(cell(dataRow, 'make')).toBe('Example Motors');
    expect(cell(dataRow, 'model')).toBe('Generic 1.4 TDI');
    expect(cell(dataRow, 'model_year')).toBe('2020');
    expect(cell(dataRow, 'first_registration')).toBe('2020-02-17');
    expect(cell(dataRow, 'mileage_km')).toBe('48500');
    expect(cell(dataRow, 'fuel')).toBe('Diesel');
    expect(cell(dataRow, 'power_kw')).toBe('110');
    expect(cell(dataRow, 'body_type')).toBe('');
    expect(cell(dataRow, 'transmission')).toBe('');
    expect(cell(dataRow, 'doors')).toBe('');
    expect(cell(dataRow, 'seats')).toBe('');
    expect(cell(dataRow, 'color')).toBe('Weiß metallic');
    expect(cell(dataRow, 'damage_status')).toBe('NONE');
    expect(cell(dataRow, 'roadworthy')).toBe('');
    expect(cell(dataRow, 'price_gross_eur')).toBe('9750.00');
    expect(cell(dataRow, 'currency')).toBe('EUR');
    expect(cell(dataRow, 'vat_display')).toBe('MARGIN');
    expect(cell(dataRow, 'nova_included')).toBe('');
    expect(cell(dataRow, 'co2_wltp_g_km')).toBe('118');
    expect(cell(dataRow, 'co2_nedc_g_km')).toBe('');
    expect(cell(dataRow, 'emission_class')).toBe('Euro 6d');
    expect(cell(dataRow, 'description_language')).toBe('');
    expect(cell(dataRow, 'description')).toBe(
      'Generic export with 17" Felgen and umlauts (Größe). Semicolon; test.',
    );
    expect(cell(dataRow, 'equipment_codes')).toBe('ABS|PARKING_CAMERA');
    expect(cell(dataRow, 'equipment_free_text')).toBe(
      'Allwetterreifen; Nebelscheinwerfer (not fitted)',
    );
    expect(cell(dataRow, 'image_files')).toBe(
      'Lfedcba9876543210fedcba9876543210_01.jpg|Lfedcba9876543210fedcba9876543210_02.jpg',
    );
    expect(cell(dataRow, 'seller_name')).toBe('');
    expect(cell(dataRow, 'seller_contact')).toBe('');
    expect(cell(dataRow, 'seller_postcode')).toBe('');
    expect(cell(dataRow, 'seller_city')).toBe('');

    const result = serializeWillhabenGenericListing(
      willhabenGenericGoldenInput,
    );
    const csvText = decodeWillhabenCsv(result.csvBytes);
    expect(result.csvBytes.subarray(0, 3)).toEqual(
      encodeWillhabenCsv(WILLHABEN_GENERIC_CSV_BOM).subarray(0, 3),
    );
    expect(csvText.startsWith(WILLHABEN_GENERIC_CSV_BOM)).toBe(true);
    expect(csvText).toContain('17"" Felgen');
    expect(csvText).toContain('Größe');
    expect(csvText).toContain('Semicolon; test.');
    expect(csvText.endsWith('\r\n')).toBe(true);
    expect(result.files[0].sha256).toBe(
      '6314cc2298acfd41c1c3cfe8589dda159caafaa002ba625cb7f65c52a6b84a19',
    );
    expect(result.sha256).toBe(
      '25bdbac4509c792fb10a9271103868df5d86d54a1876e56e8faee6d846c9af82',
    );
  });

  it('keeps one physical line per record by normalising control characters', () => {
    const result = serializeWillhabenGenericListing(
      willhabenGenericGoldenInput,
    );
    const csvText = decodeWillhabenCsv(result.csvBytes);
    expect(csvText.split('\r\n')).toHaveLength(3);
    const withoutRowTerminators = csvText.split('\r\n').join('');
    expect(
      [...withoutRowTerminators].some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ),
    ).toBe(false);
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

  it('prefixes formula-leading text with an apostrophe', () => {
    const input = {
      ...willhabenGenericGoldenInput,
      listing: {
        ...willhabenGenericGoldenInput.listing,
        title: '=1+1',
        description: '\t@SUM(A1) and 17" width',
      },
      vehicle: {
        ...willhabenGenericGoldenInput.vehicle,
        color: ' +49 1',
      },
    };

    const rows = buildWillhabenGenericCsvRows(input);
    expect(cell(rows[1], 'title')).toBe("'=1+1");
    expect(cell(rows[1], 'description')).toBe('\' @SUM(A1) and 17" width');
    expect(cell(rows[1], 'color')).toBe("'+49 1");

    const csvText = decodeWillhabenCsv(
      serializeWillhabenGenericListing(input).csvBytes,
    );
    expect(csvText).toContain('"\'=1+1"');
  });

  it('flags missing listing ref, make/model and an invalid price', () => {
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
    ]);
  });

  it('rejects pipe characters inside equipment codes and image filenames', () => {
    const issues = willhabenGenericListingSerializer.validate({
      ...willhabenGenericGoldenInput,
      equipment: {
        ...willhabenGenericGoldenInput.equipment,
        equipmentCodes: ['ABS', 'NA|VIGATION'],
      },
      images: [
        ...willhabenGenericGoldenInput.images,
        {
          sequence: 3,
          filename: 'Lfedcba9876543210fedcba9876543210_03|bad.jpg',
          bytes: Buffer.from('synthetic-jpeg-bytes-3'),
          content_sha256:
            'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        },
      ],
    });

    expect(issues).toEqual([
      {
        field: 'equipment_codes',
        code: 'LISTING_FIELD_INVALID',
        message: "Equipment code must not contain '|': NA|VIGATION",
      },
      {
        field: 'image_files',
        code: 'LISTING_FIELD_INVALID',
        message:
          "Image filename must not contain '|': Lfedcba9876543210fedcba9876543210_03|bad.jpg",
      },
    ]);
  });

  it('rejects more than the ACP limit of 30 images', () => {
    const issues = willhabenGenericListingSerializer.validate({
      ...willhabenGenericGoldenInput,
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
        field: 'images',
        code: 'LISTING_IMAGES_MAX_EXCEEDED',
        message: 'willhaben generic export allows at most 30 images.',
      },
    ]);
  });

  it('does not require export assertions (unknown damage stays UNKNOWN)', () => {
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

    const rows = buildWillhabenGenericCsvRows({
      ...willhabenGenericGoldenInput,
      exportAssertions: {
        damage_free: false,
        metallic: null,
        guarantee: null,
        jahreswagen: null,
        recommendation: null,
        demo_vehicle: null,
      },
    });
    expect(cell(rows[1], 'damage_status')).toBe('UNKNOWN');
  });
});

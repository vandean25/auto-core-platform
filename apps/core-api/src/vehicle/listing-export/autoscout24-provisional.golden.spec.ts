import { autoscout24ProvisionalGoldenInput } from './fixtures/autoscout24-provisional-golden.fixture.js';
import { sha256Buffer } from './listing-export-zip.js';
import {
  decodeWillhabenCsv,
  encodeWillhabenCsv,
} from './willhaben-generic-csv.util.js';
import {
  AUTOSCOUT24_PROVISIONAL_CSV_BOM,
  AUTOSCOUT24_PROVISIONAL_CSV_FILENAME,
  AUTOSCOUT24_PROVISIONAL_MAX_IMAGES,
} from './autoscout24-provisional-format.constants.js';
import {
  autoscout24ProvisionalColumnIndex,
  AUTOSCOUT24_PROVISIONAL_CSV_COLUMNS,
  AUTOSCOUT24_PROVISIONAL_FIELD_COUNT,
} from './autoscout24-provisional-layout.manifest.js';
import {
  autoscout24ProvisionalListingSerializer,
  buildAutoscout24ProvisionalCsvRows,
  serializeAutoscout24ProvisionalListing,
} from './autoscout24-provisional.serializer.js';

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
  column: (typeof AUTOSCOUT24_PROVISIONAL_CSV_COLUMNS)[number],
): string {
  return row[autoscout24ProvisionalColumnIndex(column)];
}

describe('autoscout24-provisional golden export', () => {
  it('pins the contract header, field placement, quoting and encoding', () => {
    const rows = buildAutoscout24ProvisionalCsvRows(
      autoscout24ProvisionalGoldenInput,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual([...AUTOSCOUT24_PROVISIONAL_CSV_COLUMNS]);
    expect(rows[1]).toHaveLength(AUTOSCOUT24_PROVISIONAL_FIELD_COUNT);

    const dataRow = rows[1];
    expect(cell(dataRow, 'listing_ref')).toBe(
      autoscout24ProvisionalGoldenInput.listingRef,
    );
    expect(cell(dataRow, 'action')).toBe('UPSERT');
    expect(cell(dataRow, 'title')).toBe(
      'Fiktives Gebrauchtfahrzeug mit Vollausstattung',
    );
    expect(cell(dataRow, 'make')).toBe('Nordlicht Fahrzeuge');
    expect(cell(dataRow, 'model')).toBe('Kompakt 2.0 TDI');
    expect(cell(dataRow, 'model_year')).toBe('2019');
    expect(cell(dataRow, 'first_registration')).toBe('2019-06-11');
    expect(cell(dataRow, 'mileage_km')).toBe('61200');
    expect(cell(dataRow, 'fuel')).toBe('Diesel');
    expect(cell(dataRow, 'power_kw')).toBe('135');
    expect(cell(dataRow, 'body_type')).toBe('');
    expect(cell(dataRow, 'transmission')).toBe('');
    expect(cell(dataRow, 'doors')).toBe('');
    expect(cell(dataRow, 'seats')).toBe('');
    expect(cell(dataRow, 'color')).toBe('Graphitgrau metallic');
    expect(cell(dataRow, 'damage_status')).toBe('NONE');
    expect(cell(dataRow, 'roadworthy')).toBe('');
    expect(cell(dataRow, 'price_gross_eur')).toBe('12490.00');
    expect(cell(dataRow, 'currency')).toBe('EUR');
    expect(cell(dataRow, 'vat_display')).toBe('STANDARD');
    expect(cell(dataRow, 'nova_included')).toBe('');
    expect(cell(dataRow, 'co2_wltp_g_km')).toBe('122');
    expect(cell(dataRow, 'co2_nedc_g_km')).toBe('');
    expect(cell(dataRow, 'emission_class')).toBe('Euro 6d-TEMP');
    expect(cell(dataRow, 'description_language')).toBe('');
    expect(cell(dataRow, 'description')).toBe(
      'Exportbeispiel mit 18" Felgen und Umlauten (Länge). Semikolon; Test.',
    );
    expect(cell(dataRow, 'equipment_codes')).toBe('ESP|NAVIGATION');
    expect(cell(dataRow, 'equipment_free_text')).toBe(
      'Sommerreifen; Anhängerkupplung (nicht verbaut)',
    );
    expect(cell(dataRow, 'image_files')).toBe(
      'La1b2c3d4e5f6789012345678901234ab_01.jpg|La1b2c3d4e5f6789012345678901234ab_02.jpg',
    );
    expect(cell(dataRow, 'seller_name')).toBe('');
    expect(cell(dataRow, 'seller_contact')).toBe('');
    expect(cell(dataRow, 'seller_postcode')).toBe('');
    expect(cell(dataRow, 'seller_city')).toBe('');

    const result = serializeAutoscout24ProvisionalListing(
      autoscout24ProvisionalGoldenInput,
    );
    const csvText = decodeWillhabenCsv(result.csvBytes);
    expect(result.csvBytes.subarray(0, 3)).toEqual(
      encodeWillhabenCsv(AUTOSCOUT24_PROVISIONAL_CSV_BOM).subarray(0, 3),
    );
    expect(csvText.startsWith(AUTOSCOUT24_PROVISIONAL_CSV_BOM)).toBe(true);
    expect(csvText).toContain('18"" Felgen');
    expect(csvText).toContain('Länge');
    expect(csvText).toContain('Semikolon; Test.');
    expect(csvText.endsWith('\r\n')).toBe(true);
    expect(result.files[0].sha256).toBe(
      '123fcdf1dc73aef487df1890335684d45762a29ea77caed70128d92a8306263c',
    );
    expect(result.sha256).toBe(
      'f4771dcff6bc836af7921a92b29ac2a6012aac90b448e7260dec45b0c03e1ee8',
    );
  });

  it('keeps one physical line per record by normalising control characters', () => {
    const result = serializeAutoscout24ProvisionalListing(
      autoscout24ProvisionalGoldenInput,
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
    const result = serializeAutoscout24ProvisionalListing(
      autoscout24ProvisionalGoldenInput,
    );
    const entryNames = listZipEntryNames(result.zipBytes);
    expect(entryNames).toEqual([
      AUTOSCOUT24_PROVISIONAL_CSV_FILENAME,
      'La1b2c3d4e5f6789012345678901234ab_01.jpg',
      'La1b2c3d4e5f6789012345678901234ab_02.jpg',
      'manifest.json',
    ]);
    expect(result.files[1].sha256).toBe(
      sha256Buffer(autoscout24ProvisionalGoldenInput.images[0].bytes),
    );
  });

  it('prefixes formula-leading text with an apostrophe', () => {
    const input = {
      ...autoscout24ProvisionalGoldenInput,
      listing: {
        ...autoscout24ProvisionalGoldenInput.listing,
        title: '=1+1',
        description: '\t@SUM(A1) and 18" width',
      },
      vehicle: {
        ...autoscout24ProvisionalGoldenInput.vehicle,
        color: ' +43 1',
      },
    };

    const rows = buildAutoscout24ProvisionalCsvRows(input);
    expect(cell(rows[1], 'title')).toBe("'=1+1");
    expect(cell(rows[1], 'description')).toBe('\' @SUM(A1) and 18" width');
    expect(cell(rows[1], 'color')).toBe("'+43 1");

    const csvText = decodeWillhabenCsv(
      serializeAutoscout24ProvisionalListing(input).csvBytes,
    );
    expect(csvText).toContain('"\'=1+1"');
  });

  it('flags missing listing ref, make/model and an invalid price', () => {
    const issues = autoscout24ProvisionalListingSerializer.validate({
      ...autoscout24ProvisionalGoldenInput,
      listingRef: '  ',
      vehicle: {
        ...autoscout24ProvisionalGoldenInput.vehicle,
        make: ' ',
        model: '',
      },
      listing: {
        ...autoscout24ProvisionalGoldenInput.listing,
        price_gross_eur: '-5.00',
      },
    });

    expect(issues).toEqual([
      {
        field: 'listing_ref',
        code: 'LISTING_REF_REQUIRED',
        message:
          'Listing reference is required for AutoScout24 provisional export.',
      },
      {
        field: 'vehicle.make_model',
        code: 'LISTING_VEHICLE_MAKE_MODEL_REQUIRED',
        message:
          'Make and model are required for AutoScout24 provisional export.',
      },
      {
        field: 'listing.price_gross_eur',
        code: 'LISTING_PRICE_GROSS_INVALID',
        message:
          'Gross price must be a positive number for AutoScout24 provisional export.',
      },
    ]);
  });

  it('rejects pipe characters inside equipment codes and image filenames', () => {
    const issues = autoscout24ProvisionalListingSerializer.validate({
      ...autoscout24ProvisionalGoldenInput,
      equipment: {
        ...autoscout24ProvisionalGoldenInput.equipment,
        equipmentCodes: ['ESP', 'NA|VIGATION'],
      },
      images: [
        ...autoscout24ProvisionalGoldenInput.images,
        {
          sequence: 3,
          filename: 'La1b2c3d4e5f6789012345678901234ab_03|bad.jpg',
          bytes: Buffer.from('synthetic-as24-jpeg-bytes-3'),
          content_sha256:
            'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
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
          "Image filename must not contain '|': La1b2c3d4e5f6789012345678901234ab_03|bad.jpg",
      },
    ]);
  });

  it('rejects more than the ACP limit of 30 images', () => {
    const issues = autoscout24ProvisionalListingSerializer.validate({
      ...autoscout24ProvisionalGoldenInput,
      images: Array.from(
        { length: AUTOSCOUT24_PROVISIONAL_MAX_IMAGES + 1 },
        (_, index) => ({
          sequence: index + 1,
          filename: `La1b2c3d4e5f6789012345678901234ab_${String(index + 1).padStart(2, '0')}.jpg`,
          bytes: Buffer.from('synthetic-as24-jpeg-bytes'),
          content_sha256:
            'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        }),
      ),
    });

    expect(issues).toEqual([
      {
        field: 'images',
        code: 'LISTING_IMAGES_MAX_EXCEEDED',
        message: 'AutoScout24 provisional export allows at most 30 images.',
      },
    ]);
  });

  it('does not require export assertions (unknown damage stays UNKNOWN)', () => {
    const issues = autoscout24ProvisionalListingSerializer.validate({
      ...autoscout24ProvisionalGoldenInput,
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

    const rows = buildAutoscout24ProvisionalCsvRows({
      ...autoscout24ProvisionalGoldenInput,
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

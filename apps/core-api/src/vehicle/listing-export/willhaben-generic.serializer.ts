import {
  buildListingExportZip,
  sha256Buffer,
  type ListingExportZipEntry,
} from './listing-export-zip.js';
import type {
  ListingSerializerFieldIssue,
  ListingSerializerFilenameInput,
  ListingSerializerInput,
  ListingSerializerPort,
  ListingSerializerResult,
} from './listing-serializer.types.js';
import {
  WILLHABEN_GENERIC_CSV_FILENAME,
  WILLHABEN_GENERIC_MAX_IMAGES,
  WILLHABEN_GENERIC_PROFILE_CODE,
  WILLHABEN_GENERIC_ROW_TERMINATOR,
} from './willhaben-generic-format.constants.js';
import {
  buildWillhabenGenericHeaderRow,
  formatWillhabenGenericBoolean,
  formatWillhabenGenericPriceGross,
  willhabenGenericColumnIndex,
  WILLHABEN_GENERIC_FIELD_COUNT,
  type WillhabenGenericCsvColumn,
} from './willhaben-generic-layout.manifest.js';
import {
  encodeWillhabenCsv,
  joinWillhabenRow,
} from './willhaben-generic-csv.util.js';

function emptyRow(): string[] {
  return Array.from({ length: WILLHABEN_GENERIC_FIELD_COUNT }, () => '');
}

function setCell(
  row: string[],
  column: WillhabenGenericCsvColumn,
  value: string,
): void {
  row[willhabenGenericColumnIndex(column)] = value;
}

function optionalText(value: string | null): string {
  return value?.trim() ?? '';
}

function optionalInteger(value: number | null, minimum: number): string {
  if (value == null || value < minimum) {
    return '';
  }
  return String(value);
}

/**
 * Builds the generic willhaben CSV rows (header + one data row).
 * Generic UNVERIFIED layout: every listing field is exported as-is and an
 * empty cell means the value is not available.
 */
export function buildWillhabenGenericCsvRows(
  input: ListingSerializerInput,
): string[][] {
  const dataRow = emptyRow();
  const assertions = input.exportAssertions;

  setCell(dataRow, 'listing_ref', input.listingRef.trim());
  setCell(dataRow, 'title', optionalText(input.listing.title));
  setCell(dataRow, 'description', input.listing.description ?? '');
  setCell(dataRow, 'category', input.listing.category.trim());
  setCell(
    dataRow,
    'price_gross_eur',
    formatWillhabenGenericPriceGross(input.listing.price_gross_eur),
  );
  setCell(dataRow, 'vat_display', input.listing.vat_display);
  setCell(dataRow, 'make', input.vehicle.make.trim());
  setCell(dataRow, 'model', input.vehicle.model.trim());
  setCell(dataRow, 'model_year', optionalInteger(input.vehicle.model_year, 1));
  setCell(
    dataRow,
    'first_registration',
    input.vehicle.first_registration ?? '',
  );
  setCell(dataRow, 'mileage_km', optionalInteger(input.vehicle.mileage_km, 0));
  setCell(dataRow, 'fuel', optionalText(input.vehicle.fuel));
  setCell(dataRow, 'power_kw', optionalInteger(input.vehicle.power_kw, 1));
  setCell(dataRow, 'color', optionalText(input.vehicle.color));
  setCell(
    dataRow,
    'co2_wltp_g_km',
    optionalInteger(input.vehicle.co2_wltp_g_km, 1),
  );
  setCell(
    dataRow,
    'co2_nedc_g_km',
    optionalInteger(input.vehicle.co2_nedc_g_km, 1),
  );
  setCell(
    dataRow,
    'emission_class',
    optionalText(input.vehicle.emission_class),
  );
  setCell(
    dataRow,
    'damage_free',
    formatWillhabenGenericBoolean(assertions?.damage_free ?? null),
  );
  setCell(
    dataRow,
    'metallic',
    formatWillhabenGenericBoolean(assertions?.metallic ?? null),
  );
  setCell(
    dataRow,
    'guarantee',
    formatWillhabenGenericBoolean(assertions?.guarantee ?? null),
  );
  setCell(
    dataRow,
    'jahreswagen',
    formatWillhabenGenericBoolean(assertions?.jahreswagen ?? null),
  );
  setCell(
    dataRow,
    'recommendation',
    formatWillhabenGenericBoolean(assertions?.recommendation ?? null),
  );
  setCell(
    dataRow,
    'demo_vehicle',
    formatWillhabenGenericBoolean(assertions?.demo_vehicle ?? null),
  );
  setCell(dataRow, 'equipment_codes', input.equipment.equipmentCodes.join(','));
  setCell(
    dataRow,
    'equipment_free_text',
    input.equipment.equipmentFreeTextLines.join('\n'),
  );
  setCell(dataRow, 'image_count', String(input.images.length));
  setCell(
    dataRow,
    'image_filenames',
    input.images.map((image) => image.filename).join(','),
  );

  return [buildWillhabenGenericHeaderRow(), dataRow];
}

export function serializeWillhabenGenericListing(
  input: ListingSerializerInput,
): ListingSerializerResult {
  const rows = buildWillhabenGenericCsvRows(input);
  const csvText = `${rows
    .map((row) => joinWillhabenRow(row))
    .join(
      WILLHABEN_GENERIC_ROW_TERMINATOR,
    )}${WILLHABEN_GENERIC_ROW_TERMINATOR}`;
  const csvBytes = encodeWillhabenCsv(csvText);

  const manifest = {
    profile: WILLHABEN_GENERIC_PROFILE_CODE,
    layout_version: input.mappingVersion,
    verification: 'UNVERIFIED',
    layout: 'GENERIC_PROVISIONAL',
    generated_at: input.generatedAt.toISOString(),
    listing_ref: input.listingRef,
    encoding: 'UTF-8',
    external_import_semantics: 'UNVERIFIED',
    files: [
      {
        name: WILLHABEN_GENERIC_CSV_FILENAME,
        sha256: sha256Buffer(csvBytes),
      },
      ...input.images.map((image) => ({
        name: image.filename,
        sha256: sha256Buffer(image.bytes),
      })),
    ],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');

  const zipEntries: ListingExportZipEntry[] = [
    {
      name: WILLHABEN_GENERIC_CSV_FILENAME,
      bytes: csvBytes,
      modifiedAt: input.generatedAt,
    },
    ...input.images.map((image) => ({
      name: image.filename,
      bytes: image.bytes,
      modifiedAt: input.generatedAt,
    })),
    {
      name: 'manifest.json',
      bytes: manifestBytes,
      modifiedAt: input.generatedAt,
    },
  ];

  const zipBytes = buildListingExportZip(zipEntries);
  const zipSha256 = sha256Buffer(zipBytes);

  return {
    files: [
      {
        name: WILLHABEN_GENERIC_CSV_FILENAME,
        bytes: csvBytes,
        sha256: sha256Buffer(csvBytes),
      },
      ...input.images.map((image) => ({
        name: image.filename,
        bytes: image.bytes,
        sha256: sha256Buffer(image.bytes),
      })),
      {
        name: 'manifest.json',
        bytes: manifestBytes,
        sha256: sha256Buffer(manifestBytes),
      },
    ],
    csvBytes,
    zipBytes,
    sha256: zipSha256,
    rowCount: 1,
    byteLength: zipBytes.length,
  };
}

function validateWillhabenGenericListing(
  input: ListingSerializerInput,
): ListingSerializerFieldIssue[] {
  const issues: ListingSerializerFieldIssue[] = [];

  if (!input.listingRef.trim()) {
    issues.push({
      field: 'listing_ref',
      code: 'LISTING_REF_REQUIRED',
      message: 'Listing reference is required for willhaben generic export.',
    });
  }
  if (!input.vehicle.make.trim() || !input.vehicle.model.trim()) {
    issues.push({
      field: 'vehicle.make_model',
      code: 'LISTING_VEHICLE_MAKE_MODEL_REQUIRED',
      message: 'Make and model are required for willhaben generic export.',
    });
  }
  try {
    formatWillhabenGenericPriceGross(input.listing.price_gross_eur);
  } catch {
    issues.push({
      field: 'listing.price_gross_eur',
      code: 'LISTING_PRICE_GROSS_INVALID',
      message:
        'Gross price must be a positive number for willhaben generic export.',
    });
  }
  if (input.images.length > WILLHABEN_GENERIC_MAX_IMAGES) {
    issues.push({
      field: 'images',
      code: 'LISTING_IMAGES_MAX_EXCEEDED',
      message: `willhaben generic export allows at most ${WILLHABEN_GENERIC_MAX_IMAGES} images.`,
    });
  }

  return issues;
}

/**
 * Generic willhaben listing export serializer.
 * UNVERIFIED provisional layout; will be replaced once the real willhaben
 * import format is known (AUT-571).
 */
export const willhabenGenericListingSerializer: ListingSerializerPort = {
  profileCode: WILLHABEN_GENERIC_PROFILE_CODE,
  platform: 'WILLHABEN',
  verification: 'UNVERIFIED',
  limits: {
    maxCsvBytes: 20 * 1024 * 1024,
    maxZipBytes: 250 * 1024 * 1024,
    maxImagesPerListing: WILLHABEN_GENERIC_MAX_IMAGES,
  },
  validate: validateWillhabenGenericListing,
  serialize: serializeWillhabenGenericListing,
  buildZipFilename(input: ListingSerializerFilenameInput): string {
    const safeRef = input.listingRef.replace(/[^A-Za-z0-9_-]/g, '_');
    return `willhaben-generic_${safeRef}.zip`;
  },
};

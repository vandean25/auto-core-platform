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
  AUTOSCOUT24_PROVISIONAL_CSV_BOM,
  AUTOSCOUT24_PROVISIONAL_CSV_FILENAME,
  AUTOSCOUT24_PROVISIONAL_MAX_IMAGES,
  AUTOSCOUT24_PROVISIONAL_PROFILE,
  AUTOSCOUT24_PROVISIONAL_ROW_TERMINATOR,
} from './autoscout24-provisional-format.constants.js';
import {
  buildAutoscout24ProvisionalHeaderRow,
  formatAutoscout24DamageStatus,
  formatAutoscout24ProvisionalPriceGross,
  autoscout24ProvisionalColumnIndex,
  AUTOSCOUT24_PROVISIONAL_ACTION,
  AUTOSCOUT24_PROVISIONAL_CURRENCY,
  AUTOSCOUT24_PROVISIONAL_FIELD_COUNT,
  type Autoscout24ProvisionalCsvColumn,
} from './autoscout24-provisional-layout.manifest.js';
import {
  encodeWillhabenCsv,
  joinWillhabenRow,
  sanitizeWillhabenCsvFieldValue,
} from './willhaben-generic-csv.util.js';

function emptyRow(): string[] {
  return Array.from({ length: AUTOSCOUT24_PROVISIONAL_FIELD_COUNT }, () => '');
}

function setCell(
  row: string[],
  column: Autoscout24ProvisionalCsvColumn,
  value: string,
): void {
  row[autoscout24ProvisionalColumnIndex(column)] =
    value === '' ? '' : sanitizeWillhabenCsvFieldValue(value);
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

/** Joins list values with `|`; a literal `|` inside a value is rejected. */
function joinAutoscout24PipeList(values: string[]): string {
  for (const value of values) {
    if (value.includes('|')) {
      throw new Error(
        `Value contains the AutoScout24 provisional list separator '|': ${value}`,
      );
    }
  }
  return values.join('|');
}

/**
 * Builds the provisional AutoScout24 CSV rows (header + one data row) for the
 * pinned ACP contract. Columns without a snapshot input today stay empty.
 */
export function buildAutoscout24ProvisionalCsvRows(
  input: ListingSerializerInput,
): string[][] {
  const dataRow = emptyRow();
  const assertions = input.exportAssertions;

  setCell(dataRow, 'listing_ref', input.listingRef.trim());
  setCell(dataRow, 'action', AUTOSCOUT24_PROVISIONAL_ACTION);
  setCell(dataRow, 'title', optionalText(input.listing.title));
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
    'damage_status',
    formatAutoscout24DamageStatus(assertions?.damage_free ?? null),
  );
  setCell(
    dataRow,
    'price_gross_eur',
    formatAutoscout24ProvisionalPriceGross(input.listing.price_gross_eur),
  );
  setCell(dataRow, 'currency', AUTOSCOUT24_PROVISIONAL_CURRENCY);
  setCell(dataRow, 'vat_display', input.listing.vat_display);
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
  setCell(dataRow, 'description', input.listing.description ?? '');
  setCell(
    dataRow,
    'equipment_codes',
    joinAutoscout24PipeList(input.equipment.equipmentCodes),
  );
  setCell(
    dataRow,
    'equipment_free_text',
    input.equipment.equipmentFreeTextLines.join('; '),
  );
  setCell(
    dataRow,
    'image_files',
    joinAutoscout24PipeList(input.images.map((image) => image.filename)),
  );

  return [buildAutoscout24ProvisionalHeaderRow(), dataRow];
}

export function serializeAutoscout24ProvisionalListing(
  input: ListingSerializerInput,
): ListingSerializerResult {
  const rows = buildAutoscout24ProvisionalCsvRows(input);
  const csvText = `${AUTOSCOUT24_PROVISIONAL_CSV_BOM}${rows
    .map((row) => joinWillhabenRow(row))
    .join(
      AUTOSCOUT24_PROVISIONAL_ROW_TERMINATOR,
    )}${AUTOSCOUT24_PROVISIONAL_ROW_TERMINATOR}`;
  const csvBytes = encodeWillhabenCsv(csvText);

  const manifest = {
    profile: AUTOSCOUT24_PROVISIONAL_PROFILE,
    layout_version: input.mappingVersion,
    verification: 'UNVERIFIED',
    layout: 'MUSTERTABELLE_BEST_EFFORT',
    generated_at: input.generatedAt.toISOString(),
    listing_ref: input.listingRef,
    encoding: 'UTF-8 with BOM',
    external_import_semantics: 'UNVERIFIED',
    files: [
      {
        name: AUTOSCOUT24_PROVISIONAL_CSV_FILENAME,
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
      name: AUTOSCOUT24_PROVISIONAL_CSV_FILENAME,
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
        name: AUTOSCOUT24_PROVISIONAL_CSV_FILENAME,
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

function validateAutoscout24ProvisionalListing(
  input: ListingSerializerInput,
): ListingSerializerFieldIssue[] {
  const issues: ListingSerializerFieldIssue[] = [];

  if (!input.listingRef.trim()) {
    issues.push({
      field: 'listing_ref',
      code: 'LISTING_REF_REQUIRED',
      message:
        'Listing reference is required for AutoScout24 provisional export.',
    });
  }
  if (!input.vehicle.make.trim() || !input.vehicle.model.trim()) {
    issues.push({
      field: 'vehicle.make_model',
      code: 'LISTING_VEHICLE_MAKE_MODEL_REQUIRED',
      message:
        'Make and model are required for AutoScout24 provisional export.',
    });
  }
  try {
    formatAutoscout24ProvisionalPriceGross(input.listing.price_gross_eur);
  } catch {
    issues.push({
      field: 'listing.price_gross_eur',
      code: 'LISTING_PRICE_GROSS_INVALID',
      message:
        'Gross price must be a positive number for AutoScout24 provisional export.',
    });
  }
  for (const code of input.equipment.equipmentCodes) {
    if (code.includes('|')) {
      issues.push({
        field: 'equipment_codes',
        code: 'LISTING_FIELD_INVALID',
        message: `Equipment code must not contain '|': ${code}`,
      });
    }
  }
  for (const image of input.images) {
    if (image.filename.includes('|')) {
      issues.push({
        field: 'image_files',
        code: 'LISTING_FIELD_INVALID',
        message: `Image filename must not contain '|': ${image.filename}`,
      });
    }
  }
  if (input.images.length > AUTOSCOUT24_PROVISIONAL_MAX_IMAGES) {
    issues.push({
      field: 'images',
      code: 'LISTING_IMAGES_MAX_EXCEEDED',
      message: `AutoScout24 provisional export allows at most ${AUTOSCOUT24_PROVISIONAL_MAX_IMAGES} images.`,
    });
  }

  return issues;
}

/**
 * Provisional AutoScout24 listing export serializer (Mustertabelle-aligned
 * best effort per AUT-570). UNVERIFIED against the official workbook until a
 * verified profile replaces it.
 */
export const autoscout24ProvisionalListingSerializer: ListingSerializerPort = {
  profileCode: AUTOSCOUT24_PROVISIONAL_PROFILE,
  platform: 'AS24',
  verification: 'UNVERIFIED',
  limits: {
    maxCsvBytes: 20 * 1024 * 1024,
    maxZipBytes: 250 * 1024 * 1024,
    maxImagesPerListing: AUTOSCOUT24_PROVISIONAL_MAX_IMAGES,
  },
  validate: validateAutoscout24ProvisionalListing,
  serialize: serializeAutoscout24ProvisionalListing,
  buildZipFilename(input: ListingSerializerFilenameInput): string {
    const safeRef = input.listingRef.replace(/[^A-Za-z0-9_-]/g, '_');
    return `autoscout24-provisional_${safeRef}.zip`;
  },
};

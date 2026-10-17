import { buildEquipmentFreeTextParagraph } from '../equipment/vehicle-equipment-portal-map.resolver.js';
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
  assertMobileDeEncodable,
  encodeMobileDeCsv,
  joinMobileDeRow,
  normalizeMobileDeMultilineText,
  sanitizeMobileDeCsvFieldValue,
} from './mobile-de-csv.util.js';
import {
  MOBILE_DE_CSV_FILENAME,
  MOBILE_DE_FIELD_COUNT,
  MOBILE_DE_DESCRIPTION_LINE_BREAK,
  MOBILE_DE_MAX_IMAGES,
  MOBILE_DE_REFERENCE_PROFILE_CODE,
} from './mobile-de-format.constants.js';
import {
  formatMobileDeMonthYear,
  formatMobileDePriceGross,
  mapMobileDeFuelCode,
  mapMobileDeVatIndicator,
  mobileDeImageIdFromListingRef,
  MOBILE_DE_REFERENCE_USED_CAR_DEFAULTS,
} from './mobile-de-layout.manifest.js';

function emptyRow(): string[] {
  return Array.from({ length: MOBILE_DE_FIELD_COUNT }, () => '');
}

function setCell(row: string[], index: number, value: string): void {
  if (index < 0 || index >= MOBILE_DE_FIELD_COUNT) {
    throw new Error(`mobile.de column index out of range: ${index}`);
  }
  row[index] = value === '' ? '' : sanitizeMobileDeCsvFieldValue(value);
}

function validateEncoding(
  issues: ListingSerializerFieldIssue[],
  field: string,
  value: string,
): void {
  try {
    assertMobileDeEncodable(value, field);
  } catch {
    issues.push({
      field,
      code: 'LISTING_FIELD_NOT_ENCODABLE',
      message: `Value is not representable in ISO-8859-15 (${field}).`,
    });
  }
}

function buildDescription(input: ListingSerializerInput): string {
  const parts: string[] = [];
  if (input.listing.description?.trim()) {
    parts.push(normalizeMobileDeMultilineText(input.listing.description));
  }
  const equipmentParagraph = buildEquipmentFreeTextParagraph(
    input.equipment.equipmentFreeTextLines,
  );
  if (equipmentParagraph) {
    parts.push(normalizeMobileDeMultilineText(equipmentParagraph));
  }
  return parts.join(MOBILE_DE_DESCRIPTION_LINE_BREAK);
}

export function buildMobileDeReferenceCsvRow(
  input: ListingSerializerInput,
): string[] {
  const row = emptyRow();
  const imageId = mobileDeImageIdFromListingRef(input.listingRef);

  for (const [index, value] of Object.entries(
    MOBILE_DE_REFERENCE_USED_CAR_DEFAULTS,
  )) {
    setCell(row, Number.parseInt(index, 10), value);
  }

  setCell(row, 1, input.listingRef);
  setCell(row, 2, input.listing.category);
  setCell(row, 3, input.vehicle.make);
  setCell(row, 4, input.vehicle.model);
  if (input.vehicle.power_kw != null && input.vehicle.power_kw > 0) {
    setCell(row, 5, String(Math.round(input.vehicle.power_kw)));
  }
  if (input.vehicle.first_registration) {
    setCell(row, 8, formatMobileDeMonthYear(input.vehicle.first_registration));
  }
  if (input.vehicle.mileage_km != null) {
    setCell(row, 9, String(input.vehicle.mileage_km));
  }
  setCell(row, 10, formatMobileDePriceGross(input.listing.price_gross_eur));
  setCell(row, 11, mapMobileDeVatIndicator(input.listing.vat_display));
  if (input.vehicle.color?.trim()) {
    setCell(row, 16, input.vehicle.color.trim());
  }
  const description = buildDescription(input);
  if (description) {
    setCell(row, 25, description);
  }
  if (input.images.length > 0) {
    setCell(row, 26, imageId);
  }
  setCell(row, 28, 'EUR');

  const fuelCode = mapMobileDeFuelCode(input.vehicle.fuel);
  if (fuelCode) {
    setCell(row, 109, fuelCode);
  }
  const co2 =
    input.vehicle.co2_wltp_g_km ?? input.vehicle.co2_nedc_g_km ?? null;
  if (co2 != null && co2 > 0) {
    setCell(row, 99, String(Math.round(co2)));
  }

  const assertions = input.exportAssertions;
  if (
    assertions &&
    assertions.damage_free !== null &&
    assertions.metallic !== null &&
    assertions.guarantee !== null &&
    assertions.jahreswagen !== null &&
    assertions.recommendation !== null &&
    assertions.demo_vehicle !== null
  ) {
    setCell(row, 15, assertions.damage_free ? '0' : '1');
    setCell(row, 20, assertions.jahreswagen ? '1' : '0');
    setCell(row, 22, assertions.recommendation ? '1' : '0');
    setCell(row, 27, assertions.metallic ? '1' : '0');
    setCell(row, 30, assertions.guarantee ? '1' : '0');
    setCell(row, 50, assertions.demo_vehicle ? '1' : '0');
  }

  for (const mapped of input.equipment.mappedFields) {
    const index = Number.parseInt(mapped.portalField, 10);
    if (!Number.isFinite(index)) {
      continue;
    }
    setCell(row, index, mapped.portalValue);
  }

  return row;
}

export function serializeMobileDeReferenceListing(
  input: ListingSerializerInput,
): ListingSerializerResult {
  const row = buildMobileDeReferenceCsvRow(input);
  const csvText = `${joinMobileDeRow(row)}\n`;
  const csvBytes = encodeMobileDeCsv(csvText);

  const manifest = {
    profile: MOBILE_DE_REFERENCE_PROFILE_CODE,
    layout_version: input.mappingVersion,
    verification: 'UNVERIFIED',
    generated_at: input.generatedAt.toISOString(),
    listing_ref: input.listingRef,
    encoding: 'ISO-8859-15',
    external_import_semantics: 'UNVERIFIED',
    files: [
      {
        name: MOBILE_DE_CSV_FILENAME,
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
      name: MOBILE_DE_CSV_FILENAME,
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
        name: MOBILE_DE_CSV_FILENAME,
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

function pushMissingAssertionIssue(
  issues: ListingSerializerFieldIssue[],
  field: string,
): void {
  issues.push({
    field,
    message: `Advisor export assertion ${field} is required for mobile.de reference export.`,
  });
}

function validateMobileDeReferenceListing(
  input: ListingSerializerInput,
): ListingSerializerFieldIssue[] {
  const issues: ListingSerializerFieldIssue[] = [];

  if (!input.listing.category.trim()) {
    issues.push({
      field: 'portal_category',
      message: 'Portal category is required for mobile.de reference export.',
    });
  }

  const assertions = input.exportAssertions;
  if (!assertions) {
    pushMissingAssertionIssue(issues, 'export_assertions');
  } else {
    if (assertions.damage_free === null) {
      pushMissingAssertionIssue(issues, 'export_assertion_damage_free');
    }
    if (assertions.metallic === null) {
      pushMissingAssertionIssue(issues, 'export_assertion_metallic');
    }
    if (assertions.guarantee === null) {
      pushMissingAssertionIssue(issues, 'export_assertion_guarantee');
    }
    if (assertions.jahreswagen === null) {
      pushMissingAssertionIssue(issues, 'export_assertion_jahreswagen');
    }
    if (assertions.recommendation === null) {
      pushMissingAssertionIssue(issues, 'export_assertion_recommendation');
    }
    if (assertions.demo_vehicle === null) {
      pushMissingAssertionIssue(issues, 'export_assertion_demo_vehicle');
    }
  }
  if (!input.vehicle.make.trim() || !input.vehicle.model.trim()) {
    issues.push({
      field: 'vehicle.make_model',
      message: 'Make and model are required for mobile.de reference export.',
    });
  }
  if (!input.vehicle.first_registration) {
    issues.push({
      field: 'vehicle.first_registration',
      message: 'First registration date is required for mobile.de export.',
    });
  }
  if (input.vehicle.mileage_km == null) {
    issues.push({
      field: 'vehicle.mileage_km',
      message: 'Mileage is required for mobile.de reference export.',
    });
  } else if (input.vehicle.mileage_km < 0) {
    issues.push({
      field: 'vehicle.mileage_km',
      message: 'Mileage must be a non-negative integer.',
    });
  }
  if (input.images.length > MOBILE_DE_MAX_IMAGES) {
    issues.push({
      field: 'images',
      message: `mobile.de reference export allows at most ${MOBILE_DE_MAX_IMAGES} images.`,
    });
  }

  validateEncoding(issues, 'listing_ref', input.listingRef);
  validateEncoding(issues, 'vehicle.make', input.vehicle.make);
  validateEncoding(issues, 'vehicle.model', input.vehicle.model);
  if (input.listing.description) {
    validateEncoding(
      issues,
      'listing.description',
      normalizeMobileDeMultilineText(input.listing.description),
    );
  }
  for (const line of input.equipment.equipmentFreeTextLines) {
    validateEncoding(issues, 'equipment_free_text', line);
  }

  if (issues.length === 0) {
    const row = buildMobileDeReferenceCsvRow(input);
    for (let index = 0; index < row.length; index += 1) {
      const value = row[index];
      if (!value) {
        continue;
      }
      validateEncoding(issues, `mobile_de_column_${index}`, value);
    }
  }

  return issues;
}

export const mobileDeReferenceListingSerializer: ListingSerializerPort = {
  profileCode: MOBILE_DE_REFERENCE_PROFILE_CODE,
  platform: 'MOBILE_DE',
  verification: 'UNVERIFIED',
  limits: {
    maxCsvBytes: 20 * 1024 * 1024,
    maxZipBytes: 250 * 1024 * 1024,
    maxImagesPerListing: MOBILE_DE_MAX_IMAGES,
  },
  validate: validateMobileDeReferenceListing,
  serialize: serializeMobileDeReferenceListing,
  buildZipFilename(input: ListingSerializerFilenameInput): string {
    const safeRef = input.listingRef.replace(/[^A-Za-z0-9_-]/g, '_');
    return `mobile-de-reference_${safeRef}.zip`;
  },
};

import type {
  EquipmentListingSerializerProfile,
  ResolvedVehicleEquipmentExport,
} from '../equipment/vehicle-equipment-portal-map.types.js';

export type ListingSerializerVerification = 'UNVERIFIED' | 'VERIFIED';

export type ListingSerializerFieldIssue = {
  field: string;
  message: string;
  code?: string;
};

export type ListingSerializerImageInput = {
  sequence: number;
  filename: string;
  bytes: Buffer;
  content_sha256: string;
};

export type ListingExportAssertions = {
  damage_free: boolean | null;
  metallic: boolean | null;
  guarantee: boolean | null;
  jahreswagen: boolean | null;
  recommendation: boolean | null;
  demo_vehicle: boolean | null;
};

export type ListingSerializerVehicleSnapshot = {
  make: string;
  model: string;
  model_year: number;
  mileage_km: number | null;
  fuel: string | null;
  power_kw: number | null;
  first_registration: string | null;
  color: string | null;
  co2_wltp_g_km: number | null;
  co2_nedc_g_km: number | null;
  emission_class: string | null;
};

export type ListingSerializerListingSnapshot = {
  title: string | null;
  description: string | null;
  price_gross_eur: string;
  vat_display: 'STANDARD' | 'MARGIN';
  category: string;
};

export type ListingSerializerInput = {
  generatedAt: Date;
  profileCode: EquipmentListingSerializerProfile;
  mappingVersion: string;
  listingRef: string;
  vehicle: ListingSerializerVehicleSnapshot;
  listing: ListingSerializerListingSnapshot;
  exportAssertions: ListingExportAssertions | null;
  equipment: ResolvedVehicleEquipmentExport;
  images: ListingSerializerImageInput[];
};

export type ListingSerializerFile = {
  name: string;
  bytes: Buffer;
  sha256: string;
};

export type ListingSerializerResult = {
  files: ListingSerializerFile[];
  csvBytes: Buffer;
  zipBytes: Buffer;
  sha256: string;
  rowCount: number;
  byteLength: number;
};

export type ListingSerializerLimits = {
  maxCsvBytes: number;
  maxZipBytes: number;
  maxImagesPerListing: number;
};

export type ListingSerializerFilenameInput = {
  listingRef: string;
  generatedAt: Date;
};

export type ListingSerializerPort = {
  profileCode: EquipmentListingSerializerProfile;
  platform: 'MOBILE_DE' | 'AS24' | 'WILLHABEN';
  verification: ListingSerializerVerification;
  limits: ListingSerializerLimits;
  validate(input: ListingSerializerInput): ListingSerializerFieldIssue[];
  serialize(input: ListingSerializerInput): ListingSerializerResult;
  buildZipFilename(input: ListingSerializerFilenameInput): string;
};

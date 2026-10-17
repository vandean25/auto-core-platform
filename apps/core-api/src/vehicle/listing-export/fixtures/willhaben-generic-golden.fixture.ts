import type { ListingSerializerInput } from '../listing-serializer.types.js';

const generatedAt = new Date('2026-04-02T08:15:00.000Z');

export const willhabenGenericGoldenInput: ListingSerializerInput = {
  generatedAt,
  profileCode: 'WILLHABEN_GENERIC_V1',
  mappingVersion: '1',
  listingRef: 'Lfedcba9876543210fedcba9876543210',
  vehicle: {
    make: 'Example Motors',
    model: 'Generic 1.4 TDI',
    model_year: 2020,
    mileage_km: 48500,
    fuel: 'Diesel',
    power_kw: 110,
    first_registration: '2020-02-17',
    color: 'Weiß metallic',
    co2_wltp_g_km: 118,
    co2_nedc_g_km: null,
    emission_class: 'Euro 6d',
  },
  listing: {
    title: 'Example used-car listing',
    description:
      'Generic export with 17" Felgen and umlauts (Größe).\nSemicolon; test.',
    price_gross_eur: '9750.00',
    vat_display: 'MARGIN',
    category: '',
  },
  exportAssertions: {
    damage_free: true,
    metallic: false,
    guarantee: null,
    jahreswagen: false,
    recommendation: null,
    demo_vehicle: false,
  },
  equipment: {
    profile: 'WILLHABEN_GENERIC_V1',
    mappingVersion: '1',
    profileVerification: 'UNVERIFIED',
    mappedFields: [],
    equipmentCodes: ['ABS', 'PARKING_CAMERA'],
    equipmentFreeTextLines: [
      'Allwetterreifen',
      'Nebelscheinwerfer (not fitted)',
    ],
  },
  images: [
    {
      sequence: 1,
      filename: 'Lfedcba9876543210fedcba9876543210_01.jpg',
      bytes: Buffer.from('synthetic-jpeg-bytes-1'),
      content_sha256:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    {
      sequence: 2,
      filename: 'Lfedcba9876543210fedcba9876543210_02.jpg',
      bytes: Buffer.from('synthetic-jpeg-bytes-2'),
      content_sha256:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  ],
};

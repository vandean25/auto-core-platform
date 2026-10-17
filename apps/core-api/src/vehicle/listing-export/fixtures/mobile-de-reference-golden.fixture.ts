import type { ListingSerializerInput } from '../listing-serializer.types.js';

const generatedAt = new Date('2026-03-15T10:30:00.000Z');

export const mobileDeReferenceGoldenInput: ListingSerializerInput = {
  generatedAt,
  profileCode: 'MOBILE_DE_REFERENCE_V1',
  mappingVersion: '1',
  listingRef: 'L0123456789abcdef0123456789abcdef',
  vehicle: {
    make: 'Synthetic Motors',
    model: 'Reference 1.6',
    model_year: 2019,
    mileage_km: 72400,
    fuel: 'Benzin',
    power_kw: 85,
    first_registration: '2019-06-12',
    color: 'Grau metallic',
    co2_wltp_g_km: 132,
    co2_nedc_g_km: null,
    emission_class: 'Euro 6d',
  },
  listing: {
    title: 'Synthetic used-car offer',
    description:
      'Reference export with 17" Felgen and umlauts (Größe). Semicolon; test.',
    price_gross_eur: '14500.00',
    vat_display: 'STANDARD',
    category: 'Car.Limousine',
  },
  equipment: {
    profile: 'MOBILE_DE_REFERENCE_V1',
    mappingVersion: '1',
    profileVerification: 'UNVERIFIED',
    mappedFields: [
      {
        localCode: 'ABS',
        portalField: '33',
        portalValue: '1',
        verification: 'UNVERIFIED',
      },
      {
        localCode: 'ESP',
        portalField: '32',
        portalValue: '1',
        verification: 'UNVERIFIED',
      },
    ],
    equipmentCodes: [],
    equipmentFreeTextLines: ['PARKING_CAMERA: Rear sensor (not fitted)'],
  },
  images: [
    {
      sequence: 1,
      filename: 'L0123456789abcdef0123456789abcdef_01.jpg',
      bytes: Buffer.from('synthetic-jpeg-bytes-1'),
      content_sha256:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    {
      sequence: 2,
      filename: 'L0123456789abcdef0123456789abcdef_02.jpg',
      bytes: Buffer.from('synthetic-jpeg-bytes-2'),
      content_sha256:
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  ],
};

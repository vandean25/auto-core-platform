import type { ListingSerializerInput } from '../listing-serializer.types.js';

const generatedAt = new Date('2026-04-02T09:30:00.000Z');

export const autoscout24ProvisionalGoldenInput: ListingSerializerInput = {
  generatedAt,
  profileCode: 'AS24_PROVISIONAL_V1',
  mappingVersion: '1',
  listingRef: 'La1b2c3d4e5f6789012345678901234ab',
  vehicle: {
    make: 'Nordlicht Fahrzeuge',
    model: 'Kompakt 2.0 TDI',
    model_year: 2019,
    mileage_km: 61200,
    fuel: 'Diesel',
    power_kw: 135,
    first_registration: '2019-06-11',
    color: 'Graphitgrau metallic',
    co2_wltp_g_km: 122,
    co2_nedc_g_km: null,
    emission_class: 'Euro 6d-TEMP',
  },
  listing: {
    title: 'Fiktives Gebrauchtfahrzeug mit Vollausstattung',
    description:
      'Exportbeispiel mit 18" Felgen und Umlauten (Länge).\nSemikolon; Test.',
    price_gross_eur: '12490.00',
    vat_display: 'STANDARD',
    category: '',
  },
  exportAssertions: {
    damage_free: true,
    metallic: true,
    guarantee: null,
    jahreswagen: false,
    recommendation: null,
    demo_vehicle: false,
  },
  equipment: {
    profile: 'AS24_PROVISIONAL_V1',
    mappingVersion: '1',
    profileVerification: 'UNVERIFIED',
    mappedFields: [],
    equipmentCodes: ['ESP', 'NAVIGATION'],
    equipmentFreeTextLines: [
      'Sommerreifen',
      'Anhängerkupplung (nicht verbaut)',
    ],
  },
  images: [
    {
      sequence: 1,
      filename: 'La1b2c3d4e5f6789012345678901234ab_01.jpg',
      bytes: Buffer.from('synthetic-as24-jpeg-bytes-1'),
      content_sha256:
        'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    },
    {
      sequence: 2,
      filename: 'La1b2c3d4e5f6789012345678901234ab_02.jpg',
      bytes: Buffer.from('synthetic-as24-jpeg-bytes-2'),
      content_sha256:
        'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    },
  ],
};

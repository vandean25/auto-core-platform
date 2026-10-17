import { WorkshopMediaPurpose } from '@prisma/client';
import { CHECK_IN_ACKNOWLEDGEMENT_TEXT_DE } from './workshop-check-in-acknowledgement.js';
import {
  WORKSHOP_CHECK_IN_EVIDENCE_SCHEMA_VERSION,
  type WorkshopCheckInEvidenceSnapshot,
} from './workshop-check-in-evidence-snapshot.js';
import type { WorkshopOrderForPdf } from './workshop-pdf.types.js';

export const WORKSHOP_PDF_FIXTURE_ORDER_NUMBER = 'WO-PDF-42';

export function buildWorkshopPdfFixtureOrder(
  overrides: Partial<WorkshopOrderForPdf> = {},
): WorkshopOrderForPdf {
  return {
    id: 'order-pdf-fixture',
    order_number: WORKSHOP_PDF_FIXTURE_ORDER_NUMBER,
    status: 'INTAKE',
    odometer: 45000,
    fuel_level: 80,
    reported_issue: 'Squeaking brakes',
    notes: 'Internal note',
    customer: {
      type: 'PRIVATE',
      first_name: 'Test',
      last_name: 'Driver',
      company_name: null,
      phone: '+431234567',
      email: 'driver@example.com',
      address_zip: '1010',
      address_city: 'Wien',
      preferred_language: 'de',
    },
    vehicle: {
      make: 'VW',
      model: 'Golf',
      year: 2020,
      vin: 'VIN-FIXTURE-001',
      plate: 'W-4242',
    },
    tasks: [
      {
        title: 'Brake inspection',
        mechanic_notes: 'Check pads',
        line_items: [
          {
            type: 'PART',
            item_no: 'PAD-01',
            description: 'Brake pad set',
            quantity: '1',
          },
        ],
      },
    ],
    check_in: null,
    ...overrides,
  };
}

const CHECK_IN_PHOTO_BYTES = Buffer.from('jpeg-photo-fixture');
const CHECK_IN_SIGNATURE_BYTES = Buffer.from('signature-png-fixture');

export const CHECK_IN_PHOTO_DATA_URL = `data:image/jpeg;base64,${CHECK_IN_PHOTO_BYTES.toString('base64')}`;
export const CHECK_IN_SIGNATURE_DATA_URL = `data:image/png;base64,${CHECK_IN_SIGNATURE_BYTES.toString('base64')}`;

export function buildWorkshopPdfFixtureCheckInSnapshot(): WorkshopCheckInEvidenceSnapshot {
  return {
    schema_version: WORKSHOP_CHECK_IN_EVIDENCE_SCHEMA_VERSION,
    check_in_id: 'check-in-pdf-fixture',
    workshop_order_id: 'order-pdf-fixture',
    condition: {
      schema_version: 1,
      tyre_season: 'WINTER',
      exterior_notes: 'Minor scuff on rear bumper',
      interior_notes: '',
    },
    damage_markers: [
      {
        id: 'marker-1',
        zone_id: 'REAR_BUMPER',
        type: 'SCRATCH',
        note: 'Light scratch',
        media_ids: ['photo-1'],
      },
    ],
    items_left: 'Umbrella',
    key_count: 2,
    warning_lights: ['ABS'],
    odometer: 45120,
    fuel_level: 55,
    media: [
      {
        id: 'photo-1',
        purpose: WorkshopMediaPurpose.CHECK_IN,
        mime_type: 'image/jpeg',
        size_bytes: CHECK_IN_PHOTO_BYTES.length,
        storage_bucket: 'media-bucket',
        storage_key: 'photo-1.jpg',
        caption: null,
      },
      {
        id: 'sig-1',
        purpose: WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
        mime_type: 'image/png',
        size_bytes: CHECK_IN_SIGNATURE_BYTES.length,
        storage_bucket: 'media-bucket',
        storage_key: 'sig-1.png',
        caption: null,
      },
    ],
    completed_at: '2026-10-17T12:00:00.000Z',
    completed_by_user_id: 'user-fixture',
    signature: {
      media_id: 'sig-1',
      content_sha256: 'b'.repeat(64),
      signed_by_name: 'Test Signer',
      signed_at: '2026-10-17T12:00:00.000Z',
      acknowledgement_version: 'check-in-signature-v1',
      acknowledgement_text: CHECK_IN_ACKNOWLEDGEMENT_TEXT_DE,
    },
    checklist: [
      {
        id: 'item-1',
        label_snapshot: 'Warning triangle present',
        passed: true,
        notes: null,
      },
    ],
  };
}

export function buildWorkshopPdfFixtureOrderWithCheckIn(): WorkshopOrderForPdf {
  const snapshot = buildWorkshopPdfFixtureCheckInSnapshot();
  return buildWorkshopPdfFixtureOrder({
    check_in: {
      id: snapshot.check_in_id,
      content_sha256: 'a'.repeat(64),
      pdf_sha256: null,
      snapshot,
      embedded: {
        photoDataUrls: { 'photo-1': CHECK_IN_PHOTO_DATA_URL },
        signatureDataUrl: CHECK_IN_SIGNATURE_DATA_URL,
      },
    },
  });
}

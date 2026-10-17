import { WorkshopMediaPurpose, type DisplayLanguage } from '@prisma/client';
import type { EscapeHtml } from '../common/pdf/pdf-layout.js';
import type { WorkshopCheckInEvidenceSnapshot } from './workshop-check-in-evidence-snapshot.js';
import { getWorkshopCheckInPdfCopy } from './workshop-pdf-check-in-copy.js';
import type { WorkshopCheckInPdfEmbeddedMedia } from './workshop-pdf-check-in.assets.js';

export const buildWorkshopCheckInSectionStyles = (): string => `
  .check-in-section { margin-top: 28px; padding-top: 20px; border-top: 2px solid #e5e7eb; page-break-inside: avoid; }
  .check-in-subtitle { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; color: #374151; margin: 16px 0 8px; }
  .check-in-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin-bottom: 12px; }
  .check-in-marker { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; margin-bottom: 8px; font-size: 11px; }
  .check-in-photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .check-in-photo { width: 96px; height: 96px; object-fit: cover; border-radius: 6px; border: 1px solid #d1d5db; }
  .check-in-signature { max-width: 280px; max-height: 120px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; }
  .check-in-checklist table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .check-in-checklist th, .check-in-checklist td { border: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; }
  .check-in-ack { font-size: 10px; color: #4b5563; white-space: pre-wrap; margin-top: 8px; padding: 10px; background: #f9fafb; border-radius: 6px; }
`;

function formatCheckInTimestamp(
  iso: string,
  documentLocale: DisplayLanguage,
): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(documentLocale === 'de' ? 'de-AT' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

function checklistStatusLabel(
  passed: boolean | null,
  copy: ReturnType<typeof getWorkshopCheckInPdfCopy>,
): string {
  if (passed === true) {
    return copy.checklistPassedLabel;
  }
  if (passed === false) {
    return copy.checklistFailedLabel;
  }
  return copy.checklistOpenLabel;
}

export function buildWorkshopCheckInSection(
  snapshot: WorkshopCheckInEvidenceSnapshot,
  embedded: WorkshopCheckInPdfEmbeddedMedia,
  escape: EscapeHtml,
  documentLocale: DisplayLanguage,
): string {
  const copy = getWorkshopCheckInPdfCopy(documentLocale);
  const warningLights =
    snapshot.warning_lights.length > 0
      ? snapshot.warning_lights.join(', ')
      : '—';

  const markersHtml = snapshot.damage_markers
    .map((marker) => {
      const photos = marker.media_ids
        .map((id) => embedded.photoDataUrls[id])
        .filter(Boolean)
        .map((url) => `<img class="check-in-photo" src="${url}" alt="" />`)
        .join('');
      return `
        <div class="check-in-marker">
          <div><strong>${escape(copy.zoneLabel(marker.zone_id))}</strong> · ${escape(copy.damageTypeLabel(marker.type))}</div>
          ${marker.note ? `<div>${escape(marker.note)}</div>` : ''}
          ${photos ? `<div class="check-in-photos">${photos}</div>` : ''}
        </div>
      `;
    })
    .join('');

  const markerPhotoIds = new Set(
    snapshot.damage_markers.flatMap((marker) => marker.media_ids),
  );
  const unattachedPhotos = snapshot.media
    .filter(
      (item) =>
        item.purpose === WorkshopMediaPurpose.CHECK_IN &&
        !markerPhotoIds.has(item.id),
    )
    .map((item) => embedded.photoDataUrls[item.id])
    .filter(Boolean)
    .map((url) => `<img class="check-in-photo" src="${url}" alt="" />`)
    .join('');

  const checklistHtml =
    snapshot.checklist && snapshot.checklist.length > 0
      ? `
        <div class="check-in-subtitle">${copy.checklistTitle}</div>
        <div class="check-in-checklist">
          <table>
            <thead>
              <tr>
                <th>${copy.checklistItemHeader}</th>
                <th style="width: 80px;">${copy.checklistStatusHeader}</th>
                <th>${copy.checklistNotesHeader}</th>
              </tr>
            </thead>
            <tbody>
              ${snapshot.checklist
                .map(
                  (item) => `
                <tr>
                  <td>${escape(item.label_snapshot)}</td>
                  <td>${escape(checklistStatusLabel(item.passed, copy))}</td>
                  <td>${escape(item.notes ?? '—')}</td>
                </tr>
              `,
                )
                .join('')}
            </tbody>
          </table>
        </div>
      `
      : '';

  return `
    <div class="section check-in-section">
      <div class="section-title" style="font-size: 14px;">${copy.sectionTitle}</div>

      <div class="check-in-subtitle">${copy.conditionTitle}</div>
      <div class="check-in-grid">
        <div>${copy.tyreSeasonLabel}: <strong>${escape(copy.tyreSeasonLabelValue(snapshot.condition.tyre_season))}</strong></div>
        <div>${copy.odometerLabel}: <strong>${escape(snapshot.odometer)} km</strong></div>
        <div>${copy.fuelLevelLabel}: <strong>${escape(snapshot.fuel_level)}%</strong></div>
      </div>
      ${
        snapshot.condition.exterior_notes
          ? `<div>${copy.exteriorNotesLabel}: ${escape(snapshot.condition.exterior_notes)}</div>`
          : ''
      }
      ${
        snapshot.condition.interior_notes
          ? `<div>${copy.interiorNotesLabel}: ${escape(snapshot.condition.interior_notes)}</div>`
          : ''
      }

      <div class="check-in-subtitle">${copy.belongingsTitle}</div>
      <div class="check-in-grid">
        <div>${copy.itemsLeftLabel}: ${escape(snapshot.items_left || '—')}</div>
        <div>${copy.keyCountLabel}: ${escape(snapshot.key_count)}</div>
        <div>${copy.warningLightsLabel}: ${escape(warningLights)}</div>
      </div>

      ${
        markersHtml
          ? `<div class="check-in-subtitle">${copy.damageMarkersTitle}</div>${markersHtml}`
          : ''
      }

      ${
        unattachedPhotos
          ? `<div class="check-in-subtitle">${copy.photosTitle}</div><div class="check-in-photos">${unattachedPhotos}</div>`
          : ''
      }

      ${checklistHtml}

      <div class="check-in-subtitle">${copy.signatureTitle}</div>
      <div>${copy.signedByLabel}: <strong>${escape(snapshot.signature.signed_by_name)}</strong></div>
      <div>${copy.signedAtLabel}: ${escape(formatCheckInTimestamp(snapshot.signature.signed_at, documentLocale))} UTC</div>
      <div class="check-in-ack">
        <div style="font-weight: 600; margin-bottom: 4px;">${copy.acknowledgementLabel}</div>
        ${escape(snapshot.signature.acknowledgement_text)}
      </div>
      <div style="margin-top: 12px;">
        <img class="check-in-signature" src="${embedded.signatureDataUrl}" alt="" />
      </div>
    </div>
  `;
}

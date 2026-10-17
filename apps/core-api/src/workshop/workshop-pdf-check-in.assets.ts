import { WorkshopMediaPurpose } from '@prisma/client';
import type { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import type { WorkshopCheckInEvidenceSnapshot } from './workshop-check-in-evidence-snapshot.js';

export type WorkshopCheckInPdfEmbeddedMedia = {
  photoDataUrls: Record<string, string>;
  signatureDataUrl: string;
};

function toDataUrl(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

export async function embedWorkshopCheckInPdfMedia(
  mediaStorage: Pick<MechanicMediaStorage, 'readObjectBytes'>,
  snapshot: WorkshopCheckInEvidenceSnapshot,
): Promise<WorkshopCheckInPdfEmbeddedMedia> {
  const photoDataUrls: Record<string, string> = {};
  const checkInPhotos = snapshot.media.filter(
    (item) => item.purpose === WorkshopMediaPurpose.CHECK_IN,
  );

  for (const photo of checkInPhotos) {
    const bytes = await mediaStorage.readObjectBytes(
      photo.storage_bucket,
      photo.storage_key,
    );
    photoDataUrls[photo.id] = toDataUrl(photo.mime_type, bytes);
  }

  const signatureMedia = snapshot.media.find(
    (item) => item.id === snapshot.signature.media_id,
  );
  if (!signatureMedia) {
    throw new Error('Check-in signature media is missing from frozen snapshot');
  }

  const signatureBytes = await mediaStorage.readObjectBytes(
    signatureMedia.storage_bucket,
    signatureMedia.storage_key,
  );
  const signatureDataUrl = toDataUrl(signatureMedia.mime_type, signatureBytes);

  return { photoDataUrls, signatureDataUrl };
}

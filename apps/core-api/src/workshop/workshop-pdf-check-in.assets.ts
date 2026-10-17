import { WorkshopMediaPurpose, type Prisma } from '@prisma/client';
import type { MechanicMediaStorage } from '../mechanic/mechanic-media.storage.js';
import { sha256Buffer } from './workshop-check-in-request-evidence.js';
import type { WorkshopCheckInEvidenceSnapshot } from './workshop-check-in-evidence-snapshot.js';

export type WorkshopCheckInPdfEmbeddedMedia = {
  photoDataUrls: Record<string, string>;
  signatureDataUrl: string;
};

type WorkshopMediaReader = {
  workshopMedia: {
    findFirst: (args: Prisma.WorkshopMediaFindFirstArgs) => Promise<{
      storage_bucket: string;
      storage_key: string;
      mime_type: string;
    } | null>;
  };
};

function toDataUrl(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

export async function embedWorkshopCheckInPdfMedia(
  deps: {
    mediaStorage: Pick<MechanicMediaStorage, 'readObjectBytes'>;
    prisma: WorkshopMediaReader;
    tenantId: string;
    checkInId: string;
  },
  snapshot: WorkshopCheckInEvidenceSnapshot,
): Promise<WorkshopCheckInPdfEmbeddedMedia> {
  const photoDataUrls: Record<string, string> = {};
  const checkInPhotos = snapshot.media.filter(
    (item) => item.purpose === WorkshopMediaPurpose.CHECK_IN,
  );

  for (const photo of checkInPhotos) {
    const bytes = await deps.mediaStorage.readObjectBytes(
      photo.storage_bucket,
      photo.storage_key,
    );
    photoDataUrls[photo.id] = toDataUrl(photo.mime_type, bytes);
  }

  const signatureMedia = await deps.prisma.workshopMedia.findFirst({
    where: {
      tenant_id: deps.tenantId,
      id: snapshot.signature.media_id,
      check_in_id: deps.checkInId,
      purpose: WorkshopMediaPurpose.CHECK_IN_SIGNATURE,
    },
    select: {
      storage_bucket: true,
      storage_key: true,
      mime_type: true,
    },
  });
  if (!signatureMedia) {
    throw new Error(
      'Check-in signature media could not be loaded for PDF rendering',
    );
  }

  const signatureBytes = await deps.mediaStorage.readObjectBytes(
    signatureMedia.storage_bucket,
    signatureMedia.storage_key,
  );
  const signatureHash = sha256Buffer(signatureBytes);
  if (signatureHash !== snapshot.signature.content_sha256) {
    throw new Error(
      'Check-in signature bytes do not match frozen evidence digest',
    );
  }

  const signatureDataUrl = toDataUrl(signatureMedia.mime_type, signatureBytes);

  return { photoDataUrls, signatureDataUrl };
}

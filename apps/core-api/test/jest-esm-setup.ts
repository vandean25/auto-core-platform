import { jest } from '@jest/globals';

Object.assign(globalThis, { jest });

if (
  !process.env.VEHICLE_MEDIA_BUCKET?.trim() &&
  !process.env.WORKSHOP_MEDIA_BUCKET?.trim()
) {
  process.env.WORKSHOP_MEDIA_BUCKET = 'test-workshop-media-bucket';
}

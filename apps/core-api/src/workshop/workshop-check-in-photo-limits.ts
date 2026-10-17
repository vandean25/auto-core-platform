import type { UploadImageResizeLimits } from '../common/media/image-processing.types.js';

/** Max dimensions for check-in photos after server-side normalisation. */
export const CHECK_IN_PHOTO_MAIN_LIMITS: UploadImageResizeLimits = {
  maxWidth: 2048,
  maxHeight: 2048,
};

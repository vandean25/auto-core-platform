export type UploadImageResizeLimits = {
  maxWidth: number;
  maxHeight: number;
};

export type ProcessUploadImageOptions = {
  /** Resize bounds for the main image (`fit: inside`, no enlargement). */
  main: UploadImageResizeLimits;
  /** When set, also emit a thumbnail within these bounds. */
  thumbnail?: UploadImageResizeLimits;
  jpegQuality?: number;
  limitInputPixels?: number;
};

export type ProcessedImageVariant = {
  bytes: Buffer;
  width: number;
  height: number;
  contentType: 'image/jpeg';
};

export type ProcessUploadImageResult = {
  main: ProcessedImageVariant;
  thumbnail?: ProcessedImageVariant;
};

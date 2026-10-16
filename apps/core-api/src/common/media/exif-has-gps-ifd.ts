const EXIF_HEADER = Buffer.from([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
const GPS_INFO_TAG = 0x8825;

/** True when the JPEG APP1 EXIF block contains an IFD0 GPSInfo (0x8825) pointer. */
export function exifHasGpsIfd(exif: Buffer): boolean {
  if (exif.length < EXIF_HEADER.length + 8) return false;
  if (!exif.subarray(0, EXIF_HEADER.length).equals(EXIF_HEADER)) {
    return false;
  }

  const tiffStart = EXIF_HEADER.length;
  const littleEndian = exif.readUInt16LE(tiffStart) === 0x4949;
  const read16 = littleEndian
    ? (offset: number) => exif.readUInt16LE(offset)
    : (offset: number) => exif.readUInt16BE(offset);
  const read32 = littleEndian
    ? (offset: number) => exif.readUInt32LE(offset)
    : (offset: number) => exif.readUInt32BE(offset);

  const ifd0Rel = read32(tiffStart + 4);
  const ifd0 = tiffStart + ifd0Rel;
  if (ifd0 + 2 > exif.length) return false;

  const entryCount = read16(ifd0);
  let offset = ifd0 + 2;
  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 12 > exif.length) return false;
    const tag = read16(offset);
    if (tag === GPS_INFO_TAG) return true;
    offset += 12;
  }
  return false;
}

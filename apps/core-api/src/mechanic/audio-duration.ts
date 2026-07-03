const WEBM_SEGMENT_ID = 0x18538067;
const WEBM_INFO_ID = 0x1549a966;
const WEBM_TIMECODE_SCALE_ID = 0x2ad7b1;
const WEBM_DURATION_ID = 0x4489;
const DEFAULT_WEBM_TIMECODE_SCALE_NS = 1_000_000;
const NANOSECONDS_PER_SECOND = 1_000_000_000;

interface EbmlElement {
  id: number;
  dataOffset: number;
  dataSize: number;
  nextOffset: number;
}

interface Vint {
  value: number;
  length: number;
  isUnknownSize: boolean;
}

function readVint(
  buffer: Buffer,
  offset: number,
  stripLengthMarker: boolean,
): Vint | null {
  const firstByte = buffer[offset];
  if (!firstByte) {
    return null;
  }

  let mask = 0x80;
  let length = 1;
  while (length <= 8 && (firstByte & mask) === 0) {
    mask >>= 1;
    length += 1;
  }

  if (length > 8 || offset + length > buffer.length) {
    return null;
  }

  let value = stripLengthMarker ? firstByte & (mask - 1) : firstByte;
  let unknownSizeMarker = stripLengthMarker && value === mask - 1;
  for (let index = 1; index < length; index += 1) {
    unknownSizeMarker = unknownSizeMarker && buffer[offset + index] === 0xff;
    value = value * 256 + buffer[offset + index];
  }

  return { value, length, isUnknownSize: unknownSizeMarker };
}

function readElement(buffer: Buffer, offset: number): EbmlElement | null {
  const id = readVint(buffer, offset, false);
  if (!id) {
    return null;
  }

  const size = readVint(buffer, offset + id.length, true);
  if (!size) {
    return null;
  }

  const dataOffset = offset + id.length + size.length;
  const nextOffset = size.isUnknownSize
    ? buffer.length
    : dataOffset + size.value;
  const dataSize = nextOffset - dataOffset;
  if (nextOffset > buffer.length) {
    return null;
  }

  return {
    id: id.value,
    dataOffset,
    dataSize,
    nextOffset,
  };
}

function findElement(
  buffer: Buffer,
  startOffset: number,
  endOffset: number,
  expectedId: number,
): EbmlElement | null {
  let offset = startOffset;
  while (offset < endOffset) {
    const element = readElement(buffer, offset);
    if (!element) {
      return null;
    }

    if (element.id === expectedId) {
      return element;
    }

    offset = element.nextOffset;
  }

  return null;
}

function readUnsignedInteger(
  buffer: Buffer,
  element: EbmlElement,
): number | null {
  if (element.dataSize < 1 || element.dataSize > 6) {
    return null;
  }

  let value = 0;
  for (
    let offset = element.dataOffset;
    offset < element.nextOffset;
    offset += 1
  ) {
    value = value * 256 + buffer[offset];
  }

  return value;
}

function readFloat(buffer: Buffer, element: EbmlElement): number | null {
  if (element.dataSize === 4) {
    return buffer.readFloatBE(element.dataOffset);
  }

  if (element.dataSize === 8) {
    return buffer.readDoubleBE(element.dataOffset);
  }

  return null;
}

function readWebmDurationSeconds(buffer: Buffer): number | undefined {
  const segment = findElement(buffer, 0, buffer.length, WEBM_SEGMENT_ID);
  if (!segment) {
    return undefined;
  }

  const info = findElement(
    buffer,
    segment.dataOffset,
    segment.nextOffset,
    WEBM_INFO_ID,
  );
  if (!info) {
    return undefined;
  }

  const duration = findElement(
    buffer,
    info.dataOffset,
    info.nextOffset,
    WEBM_DURATION_ID,
  );
  if (!duration) {
    return undefined;
  }

  const timecodeScale = findElement(
    buffer,
    info.dataOffset,
    info.nextOffset,
    WEBM_TIMECODE_SCALE_ID,
  );
  const timecodeScaleNs = timecodeScale
    ? readUnsignedInteger(buffer, timecodeScale)
    : DEFAULT_WEBM_TIMECODE_SCALE_NS;
  const durationTimecodes = readFloat(buffer, duration);

  if (!timecodeScaleNs || !durationTimecodes || durationTimecodes < 0) {
    return undefined;
  }

  return (durationTimecodes * timecodeScaleNs) / NANOSECONDS_PER_SECOND;
}

export function readAudioDurationSeconds(
  buffer: Buffer,
  mimeType: string,
): number | undefined {
  if (mimeType === 'audio/webm') {
    return readWebmDurationSeconds(buffer);
  }

  return undefined;
}

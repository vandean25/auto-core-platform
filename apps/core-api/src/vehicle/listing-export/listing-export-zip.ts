import { createHash } from 'node:crypto';

export type ListingExportZipEntry = {
  name: string;
  bytes: Buffer;
  modifiedAt: Date;
};

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc ^= buffer[index];
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  return {
    time:
      (date.getUTCHours() << 11) |
      (date.getUTCMinutes() << 5) |
      Math.floor(date.getUTCSeconds() / 2),
    date:
      ((year - 1980) << 9) |
      ((date.getUTCMonth() + 1) << 5) |
      date.getUTCDate(),
  };
}

function writeUint32LE(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function writeUint16LE(value: number): Buffer {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

/**
 * Builds a deterministic ZIP (stored, no compression) for listing exports.
 * Entry order follows the caller-provided sorted list; timestamps come from modifiedAt.
 */
export function buildListingExportZip(entries: ListingExportZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const data = entry.bytes;
    const checksum = crc32(data);
    const { time, date } = dosDateTime(entry.modifiedAt);

    const localHeader = Buffer.concat([
      Buffer.from('PK\x03\x04'),
      writeUint16LE(20),
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint16LE(time),
      writeUint16LE(date),
      writeUint32LE(checksum),
      writeUint32LE(data.length),
      writeUint32LE(data.length),
      writeUint16LE(nameBytes.length),
      writeUint16LE(0),
      nameBytes,
    ]);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.concat([
      Buffer.from('PK\x01\x02'),
      writeUint16LE(20),
      writeUint16LE(20),
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint16LE(time),
      writeUint16LE(date),
      writeUint32LE(checksum),
      writeUint32LE(data.length),
      writeUint32LE(data.length),
      writeUint16LE(nameBytes.length),
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint16LE(0),
      writeUint32LE(0),
      writeUint32LE(offset),
      nameBytes,
    ]);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localData = Buffer.concat(localParts);
  const endRecord = Buffer.concat([
    Buffer.from('PK\x05\x06'),
    writeUint16LE(0),
    writeUint16LE(0),
    writeUint16LE(entries.length),
    writeUint16LE(entries.length),
    writeUint32LE(centralDirectory.length),
    writeUint32LE(localData.length),
    writeUint16LE(0),
  ]);

  return Buffer.concat([localData, centralDirectory, endRecord]);
}

export function sha256Buffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

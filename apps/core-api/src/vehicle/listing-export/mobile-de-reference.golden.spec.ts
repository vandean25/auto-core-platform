import { mobileDeReferenceGoldenInput } from './fixtures/mobile-de-reference-golden.fixture.js';
import { decodeMobileDeCsv } from './mobile-de-csv.util.js';
import { MOBILE_DE_CSV_FILENAME, MOBILE_DE_FIELD_COUNT } from './mobile-de-format.constants.js';
import {
  buildMobileDeReferenceCsvRow,
  serializeMobileDeReferenceListing,
} from './mobile-de-reference.serializer.js';

function listZipEntryNames(zipBytes: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= zipBytes.length) {
    const signature = zipBytes.subarray(offset, offset + 4).toString('ascii');
    if (signature !== 'PK\x03\x04') {
      break;
    }
    const nameLength = zipBytes.readUInt16LE(offset + 26);
    const extraLength = zipBytes.readUInt16LE(offset + 28);
    const name = zipBytes
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString('utf8');
    const compressedSize = zipBytes.readUInt32LE(offset + 18);
    names.push(name);
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

describe('mobile-de-reference golden export', () => {
  it('pins CSV row width, quoting, encoding and field placement', () => {
    const row = buildMobileDeReferenceCsvRow(mobileDeReferenceGoldenInput);
    expect(row).toHaveLength(MOBILE_DE_FIELD_COUNT);
    expect(row[1]).toBe(mobileDeReferenceGoldenInput.listingRef);
    expect(row[2]).toBe('Car.Limousine');
    expect(row[3]).toBe('Synthetic Motors');
    expect(row[4]).toBe('Reference 1.6');
    expect(row[8]).toBe('06.2019');
    expect(row[9]).toBe('72400');
    expect(row[10]).toBe('14500.00');
    expect(row[11]).toBe('0');
    expect(row[16]).toBe('Grau metallic');
    expect(row[26]).toBe(mobileDeReferenceGoldenInput.listingRef);
    expect(row[28]).toBe('EUR');
    expect(row[32]).toBe('1');
    expect(row[33]).toBe('1');
    expect(row[99]).toBe('132');
    expect(row[109]).toBe('1');

    const result = serializeMobileDeReferenceListing(mobileDeReferenceGoldenInput);
    const csvText = decodeMobileDeCsv(result.csvBytes);
    expect(csvText.split('\n').filter((line) => line.length > 0)).toHaveLength(1);
    expect(csvText).toContain('17"" Felgen');
    expect(csvText).toContain('Größe');
    expect(csvText).toContain('Semicolon; test');
    expect(csvText).toContain(
      'Semicolon; test.\\\\Ausstattung: PARKING_CAMERA: Rear sensor (not fitted)',
    );
    expect(csvText.endsWith('\n')).toBe(true);
    expect(result.files[0].sha256).toBe(
      'fa97dbb0654251572e32870cbcf9820de9b39f26b7bc9f2f2fb99c9944621c67',
    );
    expect(result.sha256).toBe(
      'e81cd346ad4360ef6e42f58363ffbf994a634337cac24a009a67eb8b1a7d322f',
    );
  });

  it('orders ZIP entries CSV, images by sequence, then manifest', () => {
    const result = serializeMobileDeReferenceListing(mobileDeReferenceGoldenInput);
    const entryNames = listZipEntryNames(result.zipBytes);
    expect(entryNames).toEqual([
      MOBILE_DE_CSV_FILENAME,
      'L0123456789abcdef0123456789abcdef_01.jpg',
      'L0123456789abcdef0123456789abcdef_02.jpg',
      'manifest.json',
    ]);
  });

});

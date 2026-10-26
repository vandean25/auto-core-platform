import { BadRequestException } from '@nestjs/common';
import { createUtf8CsvStreamValidator } from './import-csv-encoding.util.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';

describe('createUtf8CsvStreamValidator', () => {
  it('accepts valid UTF-8 CSV bytes', () => {
    const utf8 = createUtf8CsvStreamValidator();
    utf8.feed(Buffer.from('Kunden-Nr;Name\n1;Müller\n', 'utf8'));
    utf8.finish();
  });

  it('rejects Windows-1252 bytes that are not valid UTF-8', () => {
    const utf8 = createUtf8CsvStreamValidator();
    try {
      utf8.feed(Buffer.from([0x4b, 0xfc, 0x6e, 0x64, 0x65, 0x6e]));
      utf8.finish();
      throw new Error('expected invalid encoding');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: IMPORT_ERROR_CODES.INVALID_ENCODING,
      });
    }
  });
});

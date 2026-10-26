import { BadRequestException } from '@nestjs/common';
import { IMPORT_ERROR_CODES } from './import.constants.js';

export type Utf8CsvStreamValidator = {
  feed: (chunk: Buffer) => void;
  finish: () => void;
};

export function createUtf8CsvStreamValidator(): Utf8CsvStreamValidator {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return {
    feed(chunk: Buffer) {
      try {
        decoder.decode(chunk, { stream: true });
      } catch {
        throw new BadRequestException({
          code: IMPORT_ERROR_CODES.INVALID_ENCODING,
          message: 'CSV must be UTF-8 encoded',
        });
      }
    },
    finish() {
      try {
        decoder.decode(new Uint8Array(), { stream: false });
      } catch {
        throw new BadRequestException({
          code: IMPORT_ERROR_CODES.INVALID_ENCODING,
          message: 'CSV must be UTF-8 encoded',
        });
      }
    },
  };
}

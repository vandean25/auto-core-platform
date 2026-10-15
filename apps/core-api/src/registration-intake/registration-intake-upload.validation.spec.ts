import {
  coerceRegistrationIntakeSides,
  coerceRegistrationIntakeUploadFiles,
} from './registration-intake-upload.validation.js';

describe('registration-intake-upload.validation', () => {
  it('defaults sides from file count', () => {
    expect(coerceRegistrationIntakeSides(undefined, 1)).toEqual(['FRONT']);
    expect(coerceRegistrationIntakeSides(undefined, 2)).toEqual(['FRONT', 'BACK']);
  });

  it('accepts repeated multipart side fields', () => {
    expect(coerceRegistrationIntakeSides(['FRONT', 'BACK'], 2)).toEqual([
      'FRONT',
      'BACK',
    ]);
  });

  it('rejects non-string side entries', () => {
    expect(() => coerceRegistrationIntakeSides([1, 'BACK'], 2)).toThrow();
  });

  it('rejects tampered object sides', () => {
    expect(() => coerceRegistrationIntakeSides({ side: 'FRONT' }, 1)).toThrow();
  });

  it('requires multer files with buffers', () => {
    expect(() => coerceRegistrationIntakeUploadFiles(undefined)).toThrow();
    expect(() => coerceRegistrationIntakeUploadFiles([{ size: 1 }])).toThrow();
    const file = {
      buffer: Buffer.from('x'),
      size: 1,
    } as Express.Multer.File;
    expect(coerceRegistrationIntakeUploadFiles([file])).toEqual([file]);
  });
});

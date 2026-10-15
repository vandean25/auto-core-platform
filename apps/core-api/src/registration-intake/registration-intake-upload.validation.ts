import { registrationUnsupportedFile } from './registration-intake.errors.js';

const SIDE_VALUES = new Set(['FRONT', 'BACK']);

function assertSideLabel(value: string): 'FRONT' | 'BACK' {
  const upper = value.trim().toUpperCase();
  if (!SIDE_VALUES.has(upper)) {
    throw registrationUnsupportedFile();
  }
  return upper as 'FRONT' | 'BACK';
}

/**
 * Coerces multipart `sides` from an untrusted request body into validated labels.
 * CodeQL: do not use @Body('sides') as string | string[] without this guard.
 */
export function coerceRegistrationIntakeSides(
  sidesRaw: unknown,
  fileCount: number,
): Array<'FRONT' | 'BACK'> {
  if (fileCount < 1 || fileCount > 2) {
    throw registrationUnsupportedFile();
  }

  if (sidesRaw === undefined || sidesRaw === null || sidesRaw === '') {
    return Array.from({ length: fileCount }, (_, i) =>
      i === 0 ? 'FRONT' : 'BACK',
    );
  }

  let parts: string[];
  if (Array.isArray(sidesRaw)) {
    parts = sidesRaw.map((entry) => {
      if (typeof entry !== 'string') {
        throw registrationUnsupportedFile();
      }
      return entry;
    });
  } else if (typeof sidesRaw === 'string') {
    try {
      const parsed: unknown = JSON.parse(sidesRaw);
      if (Array.isArray(parsed)) {
        parts = parsed.map((entry) => {
          if (typeof entry !== 'string') {
            throw registrationUnsupportedFile();
          }
          return entry;
        });
      } else {
        parts = sidesRaw.split(',').map((side) => side.trim());
      }
    } catch {
      parts = sidesRaw.split(',').map((side) => side.trim());
    }
  } else {
    throw registrationUnsupportedFile();
  }

  if (parts.length !== fileCount) {
    throw registrationUnsupportedFile();
  }

  return parts.map((side) => assertSideLabel(side));
}

function isMulterFile(value: unknown): value is Express.Multer.File {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Express.Multer.File;
  return Buffer.isBuffer(candidate.buffer) && typeof candidate.size === 'number';
}

/** Validates multer file entries before service logic touches buffers. */
export function coerceRegistrationIntakeUploadFiles(
  files: unknown,
): Express.Multer.File[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw registrationUnsupportedFile();
  }
  const validated: Express.Multer.File[] = [];
  for (const entry of files) {
    if (!isMulterFile(entry)) {
      throw registrationUnsupportedFile();
    }
    validated.push(entry);
  }
  return validated;
}

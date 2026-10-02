const VIN_CHARSET = /^[A-HJ-NPR-Z0-9]{17}$/;

const VIN_TRANSLITERATION: Record<string, number> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
};

const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeVin(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase().replace(/\s+/g, '') ?? '';
  return normalized.length > 0 ? normalized : null;
}

export function isValidVinFormat(vin: string): boolean {
  return VIN_CHARSET.test(vin);
}

export function isValidVinCheckDigit(vin: string): boolean {
  if (!isValidVinFormat(vin)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 17; i += 1) {
    const char = vin[i];
    const value = VIN_TRANSLITERATION[char];
    if (value === undefined) {
      return false;
    }
    sum += value * VIN_WEIGHTS[i];
  }
  const remainder = sum % 11;
  const expected = remainder === 10 ? 'X' : String(remainder);
  return vin[8] === expected;
}

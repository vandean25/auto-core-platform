/**
 * Normalizes decoder make labels for VehicleMakeAlias lookup.
 * Uppercase alphanumeric only; diacritics stripped (Citroën → CITROEN).
 */
const POSTGRES_UNACCENT_COMPATIBILITY_MAP: Record<string, string> = {
  Æ: 'AE',
  æ: 'ae',
  Ø: 'O',
  ø: 'o',
  Ł: 'L',
  ł: 'l',
  Œ: 'OE',
  œ: 'oe',
  Đ: 'D',
  đ: 'd',
  Þ: 'TH',
  þ: 'th',
  Ð: 'D',
  ð: 'd',
  ß: '',
  Ŋ: 'N',
  ŋ: 'n',
  ĸ: '',
  ı: 'i',
  ſ: 's',
};

export function normalizeVehicleMakeAlias(input: string): string {
  return input
    .replace(
      /[ÆæØøŁłŒœĐđÞþÐðßŊŋĸıſ]/g,
      (character) => POSTGRES_UNACCENT_COMPATIBILITY_MAP[character],
    )
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

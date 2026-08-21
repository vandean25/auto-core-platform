export const SLOT_MINUTES = [15, 30, 60] as const;
export type SlotMinutes = (typeof SLOT_MINUTES)[number];

export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type OpeningHourSeed = {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  isClosed: boolean;
  openTime: string;
  closeTime: string;
};

export const DEFAULT_OPENING_HOURS: readonly OpeningHourSeed[] = [
  { weekday: 1, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 2, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 3, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 4, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 5, isClosed: false, openTime: '07:30', closeTime: '17:00' },
  { weekday: 6, isClosed: false, openTime: '08:00', closeTime: '12:00' },
  { weekday: 7, isClosed: true, openTime: '07:30', closeTime: '17:00' },
];

export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function isValidHhMm(value: string): boolean {
  return HH_MM.test(value);
}

export function isOpenWindowValid(openTime: string, closeTime: string): boolean {
  return isValidHhMm(openTime) && isValidHhMm(closeTime) && closeTime > openTime;
}

export const OPENHOLIDAYS_FETCH = 'OPENHOLIDAYS_FETCH';
export type OpenHolidaysFetch = typeof fetch;

export const OPENHOLIDAYS_BASE_URL =
  'https://openholidaysapi.org/PublicHolidays';
export const OPENHOLIDAYS_TIMEOUT_MS = 3000;

export class OpenHolidaysTimeoutError extends Error {
  constructor() {
    super('OpenHolidays API timed out');
    this.name = 'OpenHolidaysTimeoutError';
  }
}

export class OpenHolidaysUnavailableError extends Error {
  constructor(status?: number) {
    super(
      status
        ? `OpenHolidays API returned ${status}`
        : 'OpenHolidays API is unavailable',
    );
    this.name = 'OpenHolidaysUnavailableError';
  }
}

export type OpenHolidaysName = {
  language?: string;
  text?: string;
};

export type OpenHolidaysRow = {
  id?: string;
  startDate?: string;
  endDate?: string;
  type?: string;
  nationwide?: boolean;
  subdivisionCode?: string;
  subdivisions?: Array<{ code?: string }>;
  name?: OpenHolidaysName[];
};

export type PublicHolidayDay = {
  externalId: string;
  observedOn: string;
  name: string;
};

export type FetchPublicHolidaysQuery = {
  countryIsoCode: string;
  validFrom: string;
  validTo: string;
  subdivisionCode?: string | null;
};

function germanName(names: OpenHolidaysName[] | undefined): string | null {
  if (!names?.length) {
    return null;
  }
  const german = names.find((entry) => entry.language === 'DE' && entry.text);
  return german?.text ?? names.find((entry) => entry.text)?.text ?? null;
}

function subdivisionCodes(row: OpenHolidaysRow): string[] {
  const codes: string[] = [];
  if (row.subdivisionCode) {
    codes.push(row.subdivisionCode);
  }
  for (const subdivision of row.subdivisions ?? []) {
    if (subdivision.code) {
      codes.push(subdivision.code);
    }
  }
  return codes;
}

export function selectPublicHolidayDays(
  rows: OpenHolidaysRow[],
  subdivisionCode: string | null,
): PublicHolidayDay[] {
  const selected: PublicHolidayDay[] = [];

  for (const row of rows) {
    if (row.type !== 'Public') {
      continue;
    }
    if (!row.id || !row.startDate || row.startDate !== row.endDate) {
      continue;
    }
    const nationwide = row.nationwide === true;
    const matchesSubdivision =
      Boolean(subdivisionCode) &&
      subdivisionCodes(row).includes(subdivisionCode as string);
    if (!nationwide && !matchesSubdivision) {
      continue;
    }
    const name = germanName(row.name);
    if (!name) {
      continue;
    }
    selected.push({
      externalId: row.id,
      observedOn: row.startDate,
      name,
    });
  }

  return selected;
}

export async function fetchPublicHolidays(
  query: FetchPublicHolidaysQuery,
  fetchImpl: OpenHolidaysFetch = fetch,
): Promise<PublicHolidayDay[]> {
  const params = new URLSearchParams({
    countryIsoCode: query.countryIsoCode,
    languageIsoCode: 'DE',
    validFrom: query.validFrom,
    validTo: query.validTo,
  });
  if (query.subdivisionCode) {
    params.set('subdivisionCode', query.subdivisionCode);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENHOLIDAYS_TIMEOUT_MS);

  try {
    const response = await fetchImpl(
      `${OPENHOLIDAYS_BASE_URL}?${params.toString()}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      throw new OpenHolidaysUnavailableError(response.status);
    }
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new OpenHolidaysUnavailableError();
    }
    return selectPublicHolidayDays(
      payload as OpenHolidaysRow[],
      query.subdivisionCode ?? null,
    );
  } catch (error) {
    if (error instanceof OpenHolidaysUnavailableError) {
      throw error;
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new OpenHolidaysTimeoutError();
    }
    throw new OpenHolidaysUnavailableError();
  } finally {
    clearTimeout(timer);
  }
}

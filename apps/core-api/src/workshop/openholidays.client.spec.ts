import {
  OpenHolidaysTimeoutError,
  OpenHolidaysUnavailableError,
  fetchPublicHolidays,
  selectPublicHolidayDays,
} from './openholidays.client';

const publicAt = {
  id: 'oh-neujahr',
  startDate: '2026-01-01',
  endDate: '2026-01-01',
  type: 'Public',
  nationwide: true,
  name: [
    { language: 'DE', text: 'Neujahr' },
    { language: 'EN', text: 'New Year' },
  ],
};

describe('OpenHolidays client', () => {
  it('keeps nationwide public single-day holidays and German names', () => {
    const selected = selectPublicHolidayDays(
      [
        publicAt,
        {
          ...publicAt,
          id: 'oh-school',
          type: 'School',
          name: [{ language: 'DE', text: 'Semesterferien' }],
        },
        {
          ...publicAt,
          id: 'oh-range',
          startDate: '2026-12-24',
          endDate: '2026-12-26',
        },
      ],
      null,
    );

    expect(selected).toEqual([
      {
        externalId: 'oh-neujahr',
        observedOn: '2026-01-01',
        name: 'Neujahr',
      },
    ]);
  });

  it('keeps a matching subdivision row when a subdivision is configured', () => {
    const selected = selectPublicHolidayDays(
      [
        {
          ...publicAt,
          id: 'oh-by',
          nationwide: false,
          subdivisions: [{ code: 'DE-BY' }],
          name: [{ language: 'DE', text: 'Heilige Drei Könige' }],
        },
      ],
      'DE-BY',
    );

    expect(selected).toHaveLength(1);
    expect(selected[0]?.name).toBe('Heilige Drei Könige');
  });

  it('throws timeout when the vendor exceeds 3s', async () => {
    const fetchMock = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    jest.useFakeTimers();
    const pending = fetchPublicHolidays(
      {
        countryIsoCode: 'AT',
        validFrom: '2026-01-01',
        validTo: '2027-12-31',
      },
      fetchMock as unknown as typeof fetch,
    );
    const assertion = expect(pending).rejects.toBeInstanceOf(
      OpenHolidaysTimeoutError,
    );
    await jest.advanceTimersByTimeAsync(3000);
    await assertion;
    jest.useRealTimers();
  });

  it('throws unavailable on a non-2xx response', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    await expect(
      fetchPublicHolidays(
        {
          countryIsoCode: 'AT',
          validFrom: '2026-01-01',
          validTo: '2027-12-31',
        },
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(OpenHolidaysUnavailableError);
  });
});

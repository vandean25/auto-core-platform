import { toGewaehrleistungReadFields } from './vehicle-sale.warranty.js';

const storedDay = (isoDay: string) => new Date(`${isoDay}T00:00:00.000Z`);

describe('toGewaehrleistungReadFields', () => {
  it('marks an expired Basisfrist and an expired Vermutungsfrist with the EXPIRED badge status', () => {
    expect(
      toGewaehrleistungReadFields(
        {
          gewaehrleistung_ends_on: storedDay('2026-10-14'),
          presumption_ends_on: storedDay('2026-10-01'),
        },
        '2026-10-15',
      ),
    ).toEqual({
      gewaehrleistung_status: 'EXPIRED',
      gewaehrleistung_ends_on_expired: true,
      presumption_ends_on_expired: true,
    });
  });

  it('keeps the badge on the Basisfrist when only the Vermutungsfrist has passed', () => {
    expect(
      toGewaehrleistungReadFields(
        {
          gewaehrleistung_ends_on: storedDay('2028-10-08'),
          presumption_ends_on: storedDay('2027-10-08'),
        },
        '2027-11-01',
      ),
    ).toEqual({
      gewaehrleistung_status: 'ACTIVE',
      gewaehrleistung_ends_on_expired: false,
      presumption_ends_on_expired: true,
    });
  });

  it('returns no badge status for a sale without a Gewährleistung snapshot', () => {
    expect(
      toGewaehrleistungReadFields(
        { gewaehrleistung_ends_on: null, presumption_ends_on: null },
        '2026-10-15',
      ),
    ).toEqual({
      gewaehrleistung_status: null,
      gewaehrleistung_ends_on_expired: false,
      presumption_ends_on_expired: false,
    });
  });
});

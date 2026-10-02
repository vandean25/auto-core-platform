import { computePickerlDue } from './compute-pickerl-due.js';

describe('computePickerlDue', () => {
  const firstRegVehicle = {
    first_registration_date: '2020-03-15',
  };

  it.each([
    {
      name: 'missing first registration',
      vehicle: { first_registration_date: null },
      records: [],
      onDate: '2026-06-01',
      expected: {
        status: 'UNKNOWN',
        due_month: null,
      },
    },
    {
      name: 'legacy first due month (3 years after Erstzulassung)',
      vehicle: firstRegVehicle,
      records: [],
      onDate: '2022-12-01',
      expected: {
        status: 'OK',
        due_month: '2023-03',
        rule_id: 'm1-legacy-pre-2027',
      },
    },
    {
      name: 'legacy due soon inside -1 month window',
      vehicle: firstRegVehicle,
      records: [],
      onDate: '2023-02-15',
      expected: {
        status: 'DUE_SOON',
        due_month: '2023-03',
      },
    },
    {
      name: 'legacy overdue after +4 month grace',
      vehicle: firstRegVehicle,
      records: [],
      onDate: '2023-08-01',
      expected: {
        status: 'OVERDUE',
        due_month: '2023-03',
      },
    },
    {
      name: 'uses latest plakette due month from records',
      vehicle: firstRegVehicle,
      records: [
        {
          inspected_on: '2023-03-10',
          plaketten_valid_until_year: 2025,
          plaketten_valid_until_month: 3,
        },
      ],
      onDate: '2024-01-01',
      expected: {
        status: 'OK',
        due_month: '2025-03',
      },
    },
    {
      name: 'KFG42 rule set from 2027-05-19 (4 year first interval)',
      vehicle: { first_registration_date: '2023-05-20' },
      records: [],
      onDate: '2026-12-01',
      ruleSetVersion: 'm1-kfg42-from-2027-05-19',
      expected: {
        status: 'OK',
        due_month: '2027-05',
        rule_id: 'm1-kfg42-from-2027-05-19',
      },
    },
    {
      name: 'KFG42 overdue with +0 grace at month end',
      vehicle: { first_registration_date: '2023-01-10' },
      records: [],
      onDate: '2027-06-01',
      ruleSetVersion: 'm1-kfg42-from-2027-05-19',
      expected: {
        status: 'OVERDUE',
        due_month: '2027-01',
      },
    },
    {
      name: 'KFG42 due soon with -4 month early window',
      vehicle: { first_registration_date: '2023-11-01' },
      records: [],
      onDate: '2027-07-15',
      ruleSetVersion: 'm1-kfg42-from-2027-05-19',
      expected: {
        status: 'DUE_SOON',
        due_month: '2027-11',
      },
    },
    {
      name: 'auto-selects KFG42 on 2027-05-19 boundary',
      vehicle: { first_registration_date: '2020-01-31' },
      records: [],
      onDate: '2027-05-19',
      expected: {
        rule_id: 'm1-kfg42-from-2027-05-19',
      },
    },
    {
      name: 'month-end Erstzulassung anniversary',
      vehicle: { first_registration_date: '2020-01-31' },
      records: [],
      onDate: '2023-01-15',
      expected: {
        due_month: '2023-01',
      },
    },
  ] as const)(
    '$name',
    ({ vehicle, records, onDate, ruleSetVersion, expected }) => {
      const result = computePickerlDue(
        vehicle,
        records,
        new Date(`${onDate}T12:00:00.000Z`),
        ruleSetVersion ?? null,
      );

      if ('status' in expected) {
        expect(result.status).toBe(expected.status);
      }
      if ('due_month' in expected) {
        expect(result.due_month).toBe(expected.due_month);
      }
      if ('rule_id' in expected) {
        expect(result.rule_id).toBe(expected.rule_id);
      }
      expect(result.warnings.some((w) => w.code === 'VEHICLE_CLASS_ASSUMED_M1')).toBe(
        true,
      );
    },
  );

  it('emits transition warning for 2027 due months under KFG42 set', () => {
    const result = computePickerlDue(
      { first_registration_date: '2020-04-01' },
      [
        {
          inspected_on: '2026-04-01',
          plaketten_valid_until_year: 2027,
          plaketten_valid_until_month: 4,
        },
      ],
      new Date('2027-06-01T12:00:00.000Z'),
      'm1-kfg42-from-2027-05-19',
    );

    expect(result.warnings.some((w) => w.code === 'TRANSITION_2027_TOLERANCE')).toBe(
      true,
    );
  });
});

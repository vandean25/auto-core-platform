import { VehiclePartyRole } from '@prisma/client';
import {
  findPartyConflict,
  isActiveOn,
  selectActiveOwner,
  suggestBillTo,
  validatePartyShape,
  type PartyInterval,
} from './vehicle-party.rules.js';

const party = (
  role: VehiclePartyRole,
  customer_id: string,
  valid_from: string | null,
  valid_to: string | null,
  id = `${role}-${customer_id}-${valid_from}`,
): PartyInterval => ({ id, role, customer_id, valid_from, valid_to });

describe('vehicle party rules', () => {
  describe('isActiveOn (half-open [valid_from, valid_to))', () => {
    it('treats blank bounds as unbounded', () => {
      expect(isActiveOn(party('OWNER', 'A', null, null), '2026-11-01')).toBe(
        true,
      );
    });

    it('includes valid_from and excludes valid_to', () => {
      const interval = party('OWNER', 'A', '2026-01-01', '2026-06-01');
      expect(isActiveOn(interval, '2026-01-01')).toBe(true);
      expect(isActiveOn(interval, '2026-05-31')).toBe(true);
      expect(isActiveOn(interval, '2026-06-01')).toBe(false);
      expect(isActiveOn(interval, '2025-12-31')).toBe(false);
    });
  });

  describe('findPartyConflict', () => {
    it('rejects overlapping OWNER intervals even for the same customer', () => {
      const existing = [party('OWNER', 'A', '2024-01-01', null)];
      expect(
        findPartyConflict(existing, party('OWNER', 'A', '2025-01-01', null)),
      ).toBeDefined();
      expect(
        findPartyConflict(existing, party('OWNER', 'B', '2025-01-01', null)),
      ).toBeDefined();
    });

    it.each(['BILL_TO', 'LEASING'] as const)(
      'rejects overlapping %s intervals for different customers',
      (role) => {
        const existing = [party(role, 'A', '2024-01-01', '2027-01-01')];
        expect(
          findPartyConflict(existing, party(role, 'B', '2026-06-01', null)),
        ).toBeDefined();
      },
    );

    it('rejects a future interval that overlaps an open-ended singleton', () => {
      const existing = [party('OWNER', 'A', '2024-01-01', null)];
      expect(
        findPartyConflict(existing, party('OWNER', 'B', '2030-01-01', '2031-01-01')),
      ).toBeDefined();
    });

    it('allows adjacent half-open intervals', () => {
      const existing = [party('OWNER', 'A', '2024-01-01', '2026-01-01')];
      expect(
        findPartyConflict(existing, party('OWNER', 'B', '2026-01-01', null)),
      ).toBeUndefined();
    });

    it('allows one OWNER, one BILL_TO and one LEASING at the same time', () => {
      const existing = [
        party('OWNER', 'A', '2024-01-01', null),
        party('BILL_TO', 'B', '2024-01-01', null),
      ];
      expect(
        findPartyConflict(existing, party('LEASING', 'C', '2024-01-01', null)),
      ).toBeUndefined();
    });

    it('allows concurrent distinct customers for DRIVER and USER', () => {
      const existing = [party('DRIVER', 'A', null, null)];
      expect(
        findPartyConflict(existing, party('DRIVER', 'B', null, null)),
      ).toBeUndefined();
      expect(
        findPartyConflict(existing, party('USER', 'A', null, null)),
      ).toBeUndefined();
    });

    it('blocks overlapping intervals for the same (customer, role) on non-singleton roles', () => {
      const existing = [party('INSURANCE', 'A', '2024-01-01', '2026-01-01')];
      expect(
        findPartyConflict(existing, party('INSURANCE', 'A', '2025-06-01', null)),
      ).toBeDefined();
      expect(
        findPartyConflict(existing, party('INSURANCE', 'A', '2026-01-01', null)),
      ).toBeUndefined();
    });

    it('blocks overlapping OWNER and PREVIOUS_OWNER for the same customer', () => {
      const existing = [party('OWNER', 'A', '2020-01-01', null)];
      expect(
        findPartyConflict(
          existing,
          party('PREVIOUS_OWNER', 'A', '2019-01-01', '2021-01-01'),
        ),
      ).toBeDefined();
      expect(
        findPartyConflict(
          existing,
          party('PREVIOUS_OWNER', 'B', '2019-01-01', '2020-01-01'),
        ),
      ).toBeUndefined();
    });

    it('ignores the party being replaced', () => {
      const existing = [party('OWNER', 'A', '2024-01-01', null, 'p-1')];
      expect(
        findPartyConflict(
          existing,
          party('OWNER', 'A', '2024-01-01', '2026-01-01', 'p-1'),
        ),
      ).toBeUndefined();
    });
  });

  describe('validatePartyShape', () => {
    const today = '2026-11-01';

    it('rejects valid_from on or after valid_to', () => {
      expect(
        validatePartyShape(party('DRIVER', 'A', '2026-01-01', '2026-01-01'), {
          today,
        })?.code,
      ).toBe('VEHICLE_PARTY_INTERVAL_INVALID');
    });

    it('requires PREVIOUS_OWNER valid_to on or before the cutoff', () => {
      expect(
        validatePartyShape(party('PREVIOUS_OWNER', 'A', null, null), { today })
          ?.code,
      ).toBe('VEHICLE_PARTY_PREVIOUS_OWNER_END_REQUIRED');
      expect(
        validatePartyShape(party('PREVIOUS_OWNER', 'A', null, '2026-11-02'), {
          today,
        })?.code,
      ).toBe('VEHICLE_PARTY_PREVIOUS_OWNER_END_REQUIRED');
      expect(
        validatePartyShape(party('PREVIOUS_OWNER', 'A', null, '2026-11-01'), {
          today,
        }),
      ).toBeNull();
    });

    it('rejects a future start for OWNER, BILL_TO and LEASING only', () => {
      for (const role of ['OWNER', 'BILL_TO', 'LEASING'] as const) {
        expect(
          validatePartyShape(party(role, 'A', '2026-11-02', null), { today })
            ?.code,
        ).toBe('VEHICLE_PARTY_FUTURE_START_UNSUPPORTED');
      }
      expect(
        validatePartyShape(party('DRIVER', 'A', '2026-11-02', null), { today }),
      ).toBeNull();
    });

    it('accepts an OWNER that starts today or earlier', () => {
      expect(
        validatePartyShape(party('OWNER', 'A', '2026-11-01', null), { today }),
      ).toBeNull();
    });
  });

  describe('selectActiveOwner', () => {
    it('returns the single OWNER active on the day and never a DRIVER', () => {
      const parties = [
        party('PREVIOUS_OWNER', 'X', null, '2020-01-01'),
        party('DRIVER', 'B', null, null),
        party('OWNER', 'A', '2020-01-01', null),
      ];
      expect(selectActiveOwner(parties, '2026-11-01')?.customer_id).toBe('A');
      expect(selectActiveOwner([parties[1]], '2026-11-01')).toBeNull();
    });
  });

  describe('suggestBillTo', () => {
    const day = '2026-11-01';

    it('prefers an active BILL_TO over LEASING', () => {
      const parties = [
        party('LEASING', 'L', null, null),
        party('BILL_TO', 'P', null, null),
      ];
      expect(suggestBillTo(parties, day)).toEqual({
        customer_id: 'P',
        role: 'BILL_TO',
      });
    });

    it('falls back to LEASING when there is no BILL_TO', () => {
      expect(
        suggestBillTo([party('LEASING', 'L', null, null)], day),
      ).toEqual({ customer_id: 'L', role: 'LEASING' });
    });

    it('ignores ended BILL_TO rows', () => {
      expect(
        suggestBillTo([party('BILL_TO', 'P', null, '2026-01-01')], day),
      ).toBeNull();
    });

    it('never resolves to the owner: owner A with driver B and no BILL_TO or LEASING gives no suggestion', () => {
      const parties = [
        party('OWNER', 'A', '2020-01-01', null),
        party('DRIVER', 'B', null, null),
      ];
      expect(suggestBillTo(parties, day)).toBeNull();
    });
  });
});

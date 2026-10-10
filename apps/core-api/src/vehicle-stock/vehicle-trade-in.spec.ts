import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  assertTradeInFirstRegistrationNotFuture,
  assertTradeInIsNotSoldVehicle,
  assertValidTradeInAllowance,
  buildMarginSaleInvoiceLines,
  netAmountDue,
  tradeInLineDescription,
} from './vehicle-trade-in.js';

const d = (value: string) => new Prisma.Decimal(value);

describe('vehicle-trade-in', () => {
  describe('assertTradeInIsNotSoldVehicle', () => {
    it('accepts a trade-in VIN that differs from the sold vehicle', () => {
      expect(() =>
        assertTradeInIsNotSoldVehicle('TRADEIN00000000001', 'SALE0000000000001'),
      ).not.toThrow();
    });

    it('rejects a trade-in VIN equal to the vehicle being sold', () => {
      expect(() =>
        assertTradeInIsNotSoldVehicle('SALE0000000000001', 'SALE0000000000001'),
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('assertTradeInFirstRegistrationNotFuture', () => {
    const now = new Date('2026-10-09T12:00:00Z');

    it('accepts an absent or past first registration date', () => {
      expect(() =>
        assertTradeInFirstRegistrationNotFuture(undefined, now),
      ).not.toThrow();
      expect(() =>
        assertTradeInFirstRegistrationNotFuture(new Date('2016-03-01'), now),
      ).not.toThrow();
    });

    it('rejects a first registration date in the future', () => {
      expect(() =>
        assertTradeInFirstRegistrationNotFuture(new Date('2027-01-01'), now),
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('assertValidTradeInAllowance', () => {
    it('accepts an allowance above zero and up to the sale price', () => {
      expect(() =>
        assertValidTradeInAllowance(d('15000.00'), d('20000.00')),
      ).not.toThrow();
      expect(() =>
        assertValidTradeInAllowance(d('20000.00'), d('20000.00')),
      ).not.toThrow();
    });

    it('rejects a zero allowance', () => {
      expect(() => assertValidTradeInAllowance(d('0'), d('20000'))).toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects a negative allowance', () => {
      expect(() => assertValidTradeInAllowance(d('-1.00'), d('20000'))).toThrow(
        UnprocessableEntityException,
      );
    });

    it('rejects an allowance above the sale price so the amount due cannot go negative', () => {
      expect(() =>
        assertValidTradeInAllowance(d('20000.01'), d('20000.00')),
      ).toThrow(UnprocessableEntityException);
    });
  });

  describe('netAmountDue', () => {
    it('nets the allowance from the sale price', () => {
      expect(netAmountDue(d('20000.00'), d('15000.00')).toFixed(2)).toBe(
        '5000.00',
      );
    });

    it('returns the full sale price when there is no trade-in', () => {
      expect(netAmountDue(d('20000.00'), null).toFixed(2)).toBe('20000.00');
    });

    it('allows a full-value trade-in that leaves nothing to pay', () => {
      expect(netAmountDue(d('12000.00'), d('12000.00')).toFixed(2)).toBe(
        '0.00',
      );
    });
  });

  describe('buildMarginSaleInvoiceLines', () => {
    const base = {
      vehicleDescription: '2018 Volkswagen Golf VIN WVWSALE0000000001',
      salePrice: d('20000.00'),
      taxRate: d('20'),
      revenueGroupName: 'Vehicle used (margin)',
    };

    it('emits only the vehicle line without a trade-in', () => {
      const lines = buildMarginSaleInvoiceLines({ ...base, tradeIn: null });

      expect(lines).toHaveLength(1);
      expect(lines[0].line_total.toFixed(2)).toBe('20000.00');
      expect(lines[0].unit_price.toFixed(2)).toBe('20000.00');
    });

    it('adds a negative trade-in credit line so the lines sum to the amount due', () => {
      const lines = buildMarginSaleInvoiceLines({
        ...base,
        tradeIn: {
          description: 'Trade-in 2016 Skoda Octavia VIN TRADEIN00000000001',
          allowance: d('15000.00'),
        },
      });

      expect(lines).toHaveLength(2);
      expect(lines[1].description).toBe(
        'Trade-in 2016 Skoda Octavia VIN TRADEIN00000000001',
      );
      expect(lines[1].unit_price.toFixed(2)).toBe('-15000.00');
      expect(lines[1].line_total.toFixed(2)).toBe('-15000.00');
      expect(lines[1].quantity.toFixed(3)).toBe('1.000');

      const total = lines.reduce(
        (sum, line) => sum.add(line.line_total),
        new Prisma.Decimal(0),
      );
      expect(total.toFixed(2)).toBe('5000.00');
    });

    it('keeps every line in the same margin revenue group and tax rate', () => {
      const lines = buildMarginSaleInvoiceLines({
        ...base,
        tradeIn: { description: 'Trade-in', allowance: d('1000') },
      });

      for (const line of lines) {
        expect(line.revenue_group_name).toBe('Vehicle used (margin)');
        expect(line.tax_rate.toFixed(2)).toBe('20.00');
      }
    });
  });

  describe('tradeInLineDescription', () => {
    it('describes the trade-in vehicle identity on the invoice line', () => {
      expect(
        tradeInLineDescription({
          year: 2016,
          make: 'Skoda',
          model: 'Octavia',
          vin: 'TRADEIN00000000001',
        }),
      ).toBe('Trade-in 2016 Skoda Octavia VIN TRADEIN00000000001');
    });
  });
});

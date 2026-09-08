import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  aggregatePoItemTotals,
  calculateLineAmounts,
  validatePoItemsAvailability,
  PoItemWithOrderVendor,
} from './purchase-invoice.helpers';

describe('purchase-invoice.helpers', () => {
  describe('aggregatePoItemTotals', () => {
    it('should correctly aggregate quantities for lines with purchaseOrderItemId', () => {
      const lines = [
        { purchaseOrderItemId: 'poi-1', quantity: 2 },
        { purchaseOrderItemId: 'poi-2', quantity: 5 },
        { purchaseOrderItemId: 'poi-1', quantity: 3 },
        { purchaseOrderItemId: undefined, quantity: 10 },
      ];

      const totals = aggregatePoItemTotals(lines);

      expect(totals.get('poi-1')).toBe(5);
      expect(totals.get('poi-2')).toBe(5);
      expect(totals.size).toBe(2);
    });

    it('should return empty map when no lines have purchaseOrderItemId', () => {
      const lines = [
        { quantity: 2 },
        { description: 'Ad-hoc expense', quantity: 5 },
      ];

      const totals = aggregatePoItemTotals(lines);
      expect(totals.size).toBe(0);
    });
  });

  describe('calculateLineAmounts', () => {
    it('should compute net, tax, and line total with default 20% tax rate', () => {
      const lines = [
        {
          description: 'Line 1',
          quantity: 2,
          unitPrice: 50,
          purchaseOrderItemId: 'poi-1',
        },
      ];

      const result = calculateLineAmounts(lines, 'tenant-1');

      expect(result.totalAmount).toBe(120); // 100 net + 20 tax
      expect(result.linesData).toEqual([
        {
          tenant_id: 'tenant-1',
          purchase_order_item_id: 'poi-1',
          description: 'Line 1',
          quantity: 2,
          unit_price: 50,
          tax_rate: 20,
          line_total: 120,
        },
      ]);
    });

    it('should compute net, tax, and line total with custom tax rate', () => {
      const lines = [
        {
          description: 'Custom Tax Line',
          quantity: 10,
          unitPrice: 10,
          taxRate: 10,
        },
      ];

      const result = calculateLineAmounts(lines, 'tenant-1');

      expect(result.totalAmount).toBe(110); // 100 net + 10 tax
      expect(result.linesData[0].tax_rate).toBe(10);
      expect(result.linesData[0].line_total).toBe(110);
    });

    it('should handle multiple lines and sum totalAmount', () => {
      const lines = [
        { description: 'A', quantity: 1, unitPrice: 100, taxRate: 0 },
        { description: 'B', quantity: 2, unitPrice: 200, taxRate: 20 },
      ];

      const result = calculateLineAmounts(lines, 'tenant-1');

      // Line A: 100 net, 0 tax = 100
      // Line B: 400 net, 80 tax = 480
      expect(result.totalAmount).toBe(580);
      expect(result.linesData).toHaveLength(2);
    });
  });

  describe('validatePoItemsAvailability', () => {
    const mockPoItemsById = new Map<string, PoItemWithOrderVendor>([
      [
        'poi-1',
        {
          id: 'poi-1',
          quantity_received: 10,
          quantity_invoiced: 4,
          purchase_order: { vendor_id: 'vendor-1' },
        },
      ],
      [
        'poi-2',
        {
          id: 'poi-2',
          quantity_received: 5,
          quantity_invoiced: 0,
          purchase_order: { vendor_id: 'vendor-2' },
        },
      ],
    ]);

    it('should pass when requested quantity is within pending amount and vendor matches', () => {
      const requested = new Map<string, number>([['poi-1', 6]]); // 10 - 4 = 6 pending

      expect(() => {
        validatePoItemsAvailability(mockPoItemsById, requested, 'vendor-1');
      }).not.toThrow();
    });

    it('should throw NotFoundException if a PO item is not found in the map', () => {
      const requested = new Map<string, number>([['poi-unknown', 1]]);

      expect(() => {
        validatePoItemsAvailability(mockPoItemsById, requested, 'vendor-1');
      }).toThrow(NotFoundException);
    });

    it('should throw BadRequestException if PO item vendor does not match invoice vendor', () => {
      const requested = new Map<string, number>([['poi-2', 1]]);

      expect(() => {
        validatePoItemsAvailability(mockPoItemsById, requested, 'vendor-1'); // belongs to vendor-2
      }).toThrow(BadRequestException);
    });

    it('should throw BadRequestException if requested quantity exceeds pending quantity', () => {
      const requested = new Map<string, number>([['poi-1', 7]]); // only 6 pending

      expect(() => {
        validatePoItemsAvailability(mockPoItemsById, requested, 'vendor-1');
      }).toThrow(BadRequestException);
    });

    it('should compare decimal pending quantities without Number() precision loss', () => {
      const decimalPoItems = new Map<string, PoItemWithOrderVendor>([
        [
          'poi-decimal',
          {
            id: 'poi-decimal',
            quantity_received: new Prisma.Decimal('1.3'),
            quantity_invoiced: new Prisma.Decimal('0.1'),
            purchase_order: { vendor_id: 'vendor-1' },
          },
        ],
      ]);
      const withinPending = new Map<string, number>([['poi-decimal', 1.2]]);
      const exceedsPending = new Map<string, number>([['poi-decimal', 1.2001]]);

      expect(() => {
        validatePoItemsAvailability(decimalPoItems, withinPending, 'vendor-1');
      }).not.toThrow();

      expect(() => {
        validatePoItemsAvailability(
          decimalPoItems,
          exceedsPending,
          'vendor-1',
        );
      }).toThrow(BadRequestException);
    });
  });
});

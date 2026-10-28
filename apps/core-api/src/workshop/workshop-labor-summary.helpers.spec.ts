import { WorkshopLineItemType } from '@prisma/client';
import {
  computeWorkshopLaborSummary,
  summarizeWorkshopLaborLine,
  type WorkshopLaborLineInput,
} from './workshop-labor-summary.helpers.js';

/**
 * Shared fixtures and expectations with
 * `apps/core-web/src/pages/workshop/hooks/useWorkshopCalculations.test.ts`:
 * the same order must produce the same labor numbers on both sides.
 */

const partLine: WorkshopLaborLineInput = {
  id: 'line-1',
  type: WorkshopLineItemType.PART,
  qty: 1,
  unitPrice: 15,
  standardAw: null,
  actualHours: null,
  internalCostRate: null,
};

const laborLine: WorkshopLaborLineInput = {
  id: 'line-2',
  type: WorkshopLineItemType.LABOR,
  qty: 0.5,
  unitPrice: 80,
  standardAw: 0.5,
  actualHours: 0.75,
  internalCostRate: 30,
};

const brakePads: WorkshopLaborLineInput = {
  id: 'line-3',
  type: WorkshopLineItemType.PART,
  qty: 2,
  unitPrice: 50,
  standardAw: null,
  actualHours: null,
  internalCostRate: null,
};

const singleTask = {
  id: 'task-1',
  lineItems: [partLine, laborLine],
};

const brakeTask = {
  id: 'task-2',
  lineItems: [brakePads],
};

describe('workshop labor summary helpers', () => {
  describe('summarizeWorkshopLaborLine', () => {
    it('computes revenue, cost, margin, and efficiency for a labor line', () => {
      const line = summarizeWorkshopLaborLine('task-1', laborLine);

      expect(line).toEqual({
        id: 'line-2',
        task_id: 'task-1',
        revenue: 40,
        cost: 22.5,
        margin: 17.5,
        efficiency: 0.5 / 0.75,
      });
    });

    it('falls back to the quantity when actual hours are missing', () => {
      const line = summarizeWorkshopLaborLine('task-1', {
        ...laborLine,
        actualHours: null,
      });

      expect(line.revenue).toBe(40);
      expect(line.cost).toBe(15);
      expect(line.margin).toBe(25);
      expect(line.efficiency).toBeNull();
    });

    it('returns null efficiency for zero actual hours', () => {
      const line = summarizeWorkshopLaborLine('task-1', {
        ...laborLine,
        actualHours: 0,
      });

      expect(line.cost).toBe(0);
      expect(line.margin).toBe(40);
      expect(line.efficiency).toBeNull();
    });

    it('returns null efficiency without a standard allowance', () => {
      const line = summarizeWorkshopLaborLine('task-1', {
        ...laborLine,
        standardAw: null,
      });

      expect(line.efficiency).toBeNull();
    });

    it('returns null cost and margin without an internal cost rate', () => {
      const line = summarizeWorkshopLaborLine('task-1', {
        ...laborLine,
        internalCostRate: null,
      });

      expect(line.revenue).toBe(40);
      expect(line.cost).toBeNull();
      expect(line.margin).toBeNull();
      expect(line.efficiency).toBe(0.5 / 0.75);
    });
  });

  describe('computeWorkshopLaborSummary', () => {
    it('sums totals across the labor lines of one task', () => {
      const summary = computeWorkshopLaborSummary([singleTask]);

      expect(summary.line_items).toHaveLength(1);
      expect(summary.totals).toEqual({
        revenue: 40,
        cost: 22.5,
        margin: 17.5,
        margin_percent: 43.75,
        standard_hours: 0.5,
        actual_hours: 0.75,
        efficiency: 0.5 / 0.75,
      });
      expect(summary.has_cost_data).toBe(true);
    });

    it('matches the frontend order totals for multiple tasks', () => {
      const summary = computeWorkshopLaborSummary([singleTask, brakeTask]);

      // Frontend fixture: only task-1 has labor; task-2 is parts only.
      expect(summary.line_items).toHaveLength(1);
      expect(summary.totals.revenue).toBe(40);
      expect(summary.totals.cost).toBe(22.5);
      expect(summary.totals.margin_percent).toBeCloseTo(43.75);
    });

    it('totals multiple labor lines and averages their efficiency', () => {
      const secondLabor: WorkshopLaborLineInput = {
        id: 'line-4',
        type: WorkshopLineItemType.LABOR,
        qty: 2,
        unitPrice: 60,
        standardAw: 1,
        actualHours: 1,
        internalCostRate: 40,
      };
      const summary = computeWorkshopLaborSummary([
        singleTask,
        { id: 'task-2', lineItems: [brakePads, secondLabor] },
      ]);

      expect(summary.line_items).toHaveLength(2);
      expect(summary.totals.revenue).toBe(160);
      expect(summary.totals.cost).toBe(62.5);
      expect(summary.totals.margin).toBe(97.5);
      expect(summary.totals.margin_percent).toBeCloseTo(60.9375);
      expect(summary.totals.standard_hours).toBe(1.5);
      expect(summary.totals.actual_hours).toBe(1.75);
      expect(summary.totals.efficiency).toBeCloseTo((0.5 / 0.75 + 1) / 2);
    });

    it('keeps cost and margin null when no labor line has a cost rate', () => {
      const summary = computeWorkshopLaborSummary([
        {
          id: 'task-1',
          lineItems: [{ ...laborLine, internalCostRate: null }],
        },
      ]);

      expect(summary.totals.revenue).toBe(40);
      expect(summary.totals.cost).toBeNull();
      expect(summary.totals.margin).toBeNull();
      expect(summary.totals.margin_percent).toBeNull();
      expect(summary.has_cost_data).toBe(false);
    });

    it('returns null order efficiency when no labor line has usable hours', () => {
      const summary = computeWorkshopLaborSummary([
        {
          id: 'task-1',
          lineItems: [{ ...laborLine, actualHours: null, standardAw: null }],
        },
      ]);

      expect(summary.totals.efficiency).toBeNull();
      expect(summary.totals.cost).toBe(15);
      expect(summary.totals.margin_percent).toBe(62.5);
    });

    it('returns zeros and null analytics for an order without labor', () => {
      const summary = computeWorkshopLaborSummary([
        { id: 'task-1', lineItems: [partLine] },
      ]);

      expect(summary.line_items).toEqual([]);
      expect(summary.totals).toEqual({
        revenue: 0,
        cost: null,
        margin: null,
        margin_percent: null,
        standard_hours: 0,
        actual_hours: 0,
        efficiency: null,
      });
      expect(summary.has_cost_data).toBe(false);
    });

    it('handles zero quantity without inventing a margin percent', () => {
      const summary = computeWorkshopLaborSummary([
        {
          id: 'task-1',
          lineItems: [
            {
              ...laborLine,
              qty: 0,
              actualHours: null,
              standardAw: null,
            },
          ],
        },
      ]);

      expect(summary.line_items[0].revenue).toBe(0);
      expect(summary.line_items[0].cost).toBe(0);
      expect(summary.line_items[0].margin).toBe(0);
      expect(summary.totals.margin_percent).toBeNull();
      expect(summary.has_cost_data).toBe(true);
    });

    it('treats a task without line items as empty', () => {
      const summary = computeWorkshopLaborSummary([
        { id: 'task-1' },
        { id: 'task-2', lineItems: null },
      ]);

      expect(summary.line_items).toEqual([]);
      expect(summary.totals.revenue).toBe(0);
    });
  });
});

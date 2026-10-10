import {
  toMcpInspectionRow,
  toMcpOrderRow,
  type McpOrderCandidate,
} from './mcp-order-history.mapper.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000e1';

describe('mcp-order-history.mapper', () => {
  it('maps an order to the compact row, with the gross total when invoiced', () => {
    const candidate: McpOrderCandidate = {
      kind: 'workshop_order',
      id: ORDER_ID,
      orderNumber: 'WO-2026-0007',
      status: 'INVOICED',
      createdAt: new Date('2026-09-01T08:00:00.000Z'),
      vehicle: {
        id: 'v-1',
        plate: 'TS-100 A',
        make: 'Testmarke',
        model: 'Modell T',
      },
    };

    expect(toMcpOrderRow(candidate, '174.00')).toEqual({
      id: ORDER_ID,
      kind: 'workshop_order',
      number: 'WO-2026-0007',
      status: 'INVOICED',
      vehicle: {
        id: 'v-1',
        plate: 'TS-100 A',
        make: 'Testmarke',
        model: 'Modell T',
      },
      date: '2026-09-01T08:00:00.000Z',
      total_gross: '174.00',
    });
  });

  it('reports no gross total for an order that is not invoiced', () => {
    const candidate: McpOrderCandidate = {
      kind: 'sales_order',
      id: ORDER_ID,
      orderNumber: 'SO-2026-1001',
      status: 'DRAFT',
      createdAt: new Date('2026-09-10T08:00:00.000Z'),
      vehicle: null,
    };

    expect(toMcpOrderRow(candidate, null)).toEqual(
      expect.objectContaining({ vehicle: null, total_gross: null }),
    );
  });

  it('formats an inspection with the inspection date and the sticker validity as YYYY-MM', () => {
    expect(
      toMcpInspectionRow({
        id: ORDER_ID,
        inspection_type: 'PICKERL',
        inspected_on: new Date('2026-03-01T00:00:00.000Z'),
        plaketten_valid_until_year: 2028,
        plaketten_valid_until_month: 3,
        station_name: null,
      }),
    ).toEqual({
      id: ORDER_ID,
      inspection_type: 'PICKERL',
      inspected_on: '2026-03-01',
      plaketten_valid_until: '2028-03',
      station_name: null,
    });
  });
});

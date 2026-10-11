import { MCP_TOOL_NAMES } from './mcp.constants.js';
import { encodeMcpCursor, encodeMcpKeysetCursor } from './mcp-output.util.js';
import {
  getCustomerInputSchema,
  getDocumentPdfInputSchema,
  getVehicleHistoryInputSchema,
  listDocumentsInputSchema,
} from './mcp-tool-schemas.js';

const VEHICLE_ID = '00000000-0000-4000-8000-000000000099';

describe('MCP tool input schemas for customer, vehicle history, and documents (AUT-459)', () => {
  const DOCUMENT_ID = `invoice:${VEHICLE_ID}`;
  const keysetCursor = encodeMcpKeysetCursor({
    at: '2026-10-10T09:00:00.000Z',
    id: VEHICLE_ID,
  });

  it('caps the customer order page at 25 and accepts an orders cursor', () => {
    expect(
      getCustomerInputSchema.parse({
        customer_id: VEHICLE_ID,
        orders_page_size: 25,
        orders_cursor: keysetCursor,
      }),
    ).toEqual({
      customer_id: VEHICLE_ID,
      orders_page_size: 25,
      orders_cursor: keysetCursor,
    });
    expect(() =>
      getCustomerInputSchema.parse({
        customer_id: VEHICLE_ID,
        orders_page_size: 26,
      }),
    ).toThrow();
  });

  it('rejects an orders cursor that is not a keyset cursor', () => {
    expect(() =>
      getVehicleHistoryInputSchema.parse({
        vehicle_id: VEHICLE_ID,
        orders_cursor: encodeMcpCursor(10),
      }),
    ).toThrow('cursor is invalid');
  });

  it('accepts an entity filter only as a pair', () => {
    expect(
      listDocumentsInputSchema.parse({
        entity_type: 'vehicle',
        entity_id: VEHICLE_ID,
      }),
    ).toEqual({ entity_type: 'vehicle', entity_id: VEHICLE_ID });
    expect(() =>
      listDocumentsInputSchema.parse({ entity_type: 'vehicle' }),
    ).toThrow('entity_type and entity_id must be given together');
    expect(() =>
      listDocumentsInputSchema.parse({ entity_id: VEHICLE_ID }),
    ).toThrow('entity_type and entity_id must be given together');
  });

  it('rejects a document type or entity type outside the documented lists', () => {
    expect(() =>
      listDocumentsInputSchema.parse({ type: 'estimate_pdf' }),
    ).toThrow();
    expect(() =>
      listDocumentsInputSchema.parse({
        entity_type: 'supplier',
        entity_id: VEHICLE_ID,
      }),
    ).toThrow();
  });

  it('caps the document page at 25 and accepts a keyset cursor', () => {
    expect(
      listDocumentsInputSchema.parse({
        type: 'credit_note',
        pageSize: 25,
        cursor: keysetCursor,
      }),
    ).toEqual({
      type: 'credit_note',
      pageSize: 25,
      cursor: keysetCursor,
    });
    expect(() => listDocumentsInputSchema.parse({ pageSize: 26 })).toThrow();
  });

  it('accepts only <type>:<uuid> document IDs', () => {
    expect(getDocumentPdfInputSchema.parse({ id: DOCUMENT_ID })).toEqual({
      id: DOCUMENT_ID,
    });
    expect(() => getDocumentPdfInputSchema.parse({ id: VEHICLE_ID })).toThrow(
      'id must be <type>:<uuid>',
    );
    expect(() =>
      getDocumentPdfInputSchema.parse({ id: 'invoice:not-a-uuid' }),
    ).toThrow();
  });

  it('registers every AUT-459 tool as a read tool', () => {
    expect(MCP_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        'get_vehicle_history',
        'list_documents',
        'get_document_pdf',
      ]),
    );
  });
});

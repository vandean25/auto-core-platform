import {
  fingerprintMcpWriteArgs,
  parseMcpWriteCommandInput,
} from './mcp-write-command-idempotency.util.js';

describe('mcp-write-command-idempotency.util', () => {
  it('strips command_id from business input', () => {
    const parsed = parseMcpWriteCommandInput({
      vehicle_id: '00000000-0000-4000-8000-000000000001',
      command_id: '51500000-0000-4000-8000-000000000529',
    });
    expect(parsed.commandId).toBe('51500000-0000-4000-8000-000000000529');
    expect(parsed.businessInput).toEqual({
      vehicle_id: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('fingerprints tool args in a stable order', () => {
    const a = fingerprintMcpWriteArgs('draft_workshop_order', {
      notes: 'a',
      vehicle_id: 'v1',
    });
    const b = fingerprintMcpWriteArgs('draft_workshop_order', {
      vehicle_id: 'v1',
      notes: 'a',
    });
    const c = fingerprintMcpWriteArgs('draft_workshop_order', {
      vehicle_id: 'v1',
      notes: 'b',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

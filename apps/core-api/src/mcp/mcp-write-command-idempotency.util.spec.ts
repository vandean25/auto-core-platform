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
    expect(parsed.dryRun).toBe(false);
  });

  it('strips dry_run from business input and sets the dryRun flag', () => {
    const parsed = parseMcpWriteCommandInput({
      vehicle_id: '00000000-0000-4000-8000-000000000001',
      dry_run: true,
    });
    expect(parsed.dryRun).toBe(true);
    expect(parsed.businessInput).toEqual({
      vehicle_id: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('excludes dry_run from idempotency fingerprints', () => {
    const withDryRun = fingerprintMcpWriteArgs('draft_workshop_order', {
      vehicle_id: 'v1',
      dry_run: true,
    });
    const withoutDryRun = fingerprintMcpWriteArgs('draft_workshop_order', {
      vehicle_id: 'v1',
    });
    expect(withDryRun).toBe(withoutDryRun);
  });

  it('fingerprints tool args in a stable order for object keys', () => {
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

  it('treats array element order as significant', () => {
    const forward = fingerprintMcpWriteArgs('test', { ids: ['a', 'b'] });
    const reversed = fingerprintMcpWriteArgs('test', { ids: ['b', 'a'] });
    expect(forward).not.toBe(reversed);
  });
});

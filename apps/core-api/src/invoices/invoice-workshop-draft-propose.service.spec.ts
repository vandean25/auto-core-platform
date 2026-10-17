import { proposeInvoiceDraftFromOrderInputSchema } from './invoice-workshop-draft-propose.schema.js';

describe('proposeInvoiceDraftFromOrderInputSchema', () => {
  it('accepts workshop_order_id and optional command_id', () => {
    expect(
      proposeInvoiceDraftFromOrderInputSchema.parse({
        workshop_order_id: '00000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      workshop_order_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(
      proposeInvoiceDraftFromOrderInputSchema.parse({
        workshop_order_id: '00000000-0000-4000-8000-000000000001',
        command_id: '00000000-0000-4000-8000-000000000099',
      }).command_id,
    ).toBe('00000000-0000-4000-8000-000000000099');
  });

  it('rejects unknown fields', () => {
    expect(() =>
      proposeInvoiceDraftFromOrderInputSchema.parse({
        workshop_order_id: '00000000-0000-4000-8000-000000000001',
        site_id: '00000000-0000-4000-8000-000000000002',
      }),
    ).toThrow();
  });
});

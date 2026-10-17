import { proposeEstimateSendInputSchema } from './workshop-estimate-send-propose.schema.js';

describe('proposeEstimateSendInputSchema', () => {
  it('requires workshop_order_id and email channel', () => {
    expect(
      proposeEstimateSendInputSchema.parse({
        workshop_order_id: '00000000-0000-4000-8000-000000000001',
        channel: 'email',
      }),
    ).toMatchObject({ channel: 'email' });
  });

  it('rejects unknown channels', () => {
    expect(() =>
      proposeEstimateSendInputSchema.parse({
        workshop_order_id: '00000000-0000-4000-8000-000000000001',
        channel: 'sms',
      }),
    ).toThrow();
  });
});

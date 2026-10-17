import { previewReadyEmailOnCompletion } from './workshop-order-ready-notice.js';

describe('previewReadyEmailOnCompletion', () => {
  const base = {
    orderStatus: 'COMPLETED',
    purpose: 'CUSTOMER_REPAIR',
    customer: {
      id: 'cust-1',
      contact_email_ok: true,
      email: 'driver@example.at',
    },
    vehicle: { make: 'VW', model: 'Golf' },
    sellerName: 'Pilot Garage',
    sellerReady: true,
    latestReadyEmailStatus: null,
  };

  it('returns will_send false when notify_customer is false', () => {
    expect(
      previewReadyEmailOnCompletion({
        ...base,
        notifyCustomer: false,
        willReachCompleted: true,
      }),
    ).toEqual({ will_send: false, notice_code: null });
  });

  it('returns will_send true with QUEUED when completion will queue email', () => {
    expect(
      previewReadyEmailOnCompletion({
        ...base,
        notifyCustomer: true,
        willReachCompleted: true,
      }),
    ).toEqual({ will_send: true, notice_code: 'QUEUED' });
  });

  it('returns will_send false when order will not reach COMPLETED', () => {
    expect(
      previewReadyEmailOnCompletion({
        ...base,
        notifyCustomer: true,
        willReachCompleted: false,
      }),
    ).toEqual({ will_send: false, notice_code: null });
  });
});

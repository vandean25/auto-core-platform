import { buildWorkshopOrderReadyCustomerEmail } from './workshop-order-ready-customer-email.js';

const BASE = {
  customer: { id: 'c1', contact_email_ok: true, email: 'kunde@example.at' },
  vehicle: { make: 'Skoda', model: 'Octavia' },
  sellerName: 'Werkstatt',
  orderNumber: 'WO-2026-0001',
  tenantDefaultLocale: 'de' as const,
};

describe('buildWorkshopOrderReadyCustomerEmail', () => {
  it('renders a draft when contact details are valid', () => {
    const result = buildWorkshopOrderReadyCustomerEmail(BASE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.subject).toBe('WO-2026-0001');
    }
  });

  it('refuses when contact_email_ok is false', () => {
    const result = buildWorkshopOrderReadyCustomerEmail({
      ...BASE,
      customer: { ...BASE.customer, contact_email_ok: false },
    });
    expect(result).toEqual({
      ok: false,
      code: 'READY_EMAIL_NOT_CONFIRMED',
      message: expect.any(String),
    });
  });
});

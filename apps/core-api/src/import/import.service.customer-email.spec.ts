import { ImportEntityType, ImportRowAction } from '@prisma/client';
import {
  JOB_ID,
  arrangeApply,
  importJobRecord,
  jobRowRecord,
  setupImportHarness,
} from './import.service.spec.support.js';

// An overwriting customer import that changes the address withdraws the advisor's confirmation (ADR-0025 §8).
describe('customer import and the estimate email confirmation', () => {
  const h = setupImportHarness();

  const CURRENT = {
    type: 'PRIVATE',
    company_name: null,
    first_name: 'Anna',
    last_name: 'Berger',
    phone: null,
    vat_id: null,
    address_street: null,
    address_zip: null,
    address_city: null,
    address_country: null,
  };

  function arrangeOverwrite(email: string, phone: string | null) {
    arrangeApply(
      h,
      importJobRecord({
        entity_type: ImportEntityType.CUSTOMER,
        options_json: { update_existing: true, fill_empty_only: false },
      }),
      [
        jobRowRecord({
          row_no: 1,
          action: ImportRowAction.UPDATE,
          entity_id: 'cust-1',
          external_id: 'K-1',
          normalized_json: { external_id: 'K-1', ...CURRENT, email, phone },
        }),
      ],
    );
  }

  beforeEach(() => {
    h.prisma.externalIdMapping.findFirst.mockResolvedValue(null);
    h.prisma.externalIdMapping.create.mockResolvedValue({});
    h.prisma.externalIdMapping.upsert.mockResolvedValue({});
    h.prisma.customer.findFirst.mockResolvedValue({
      id: 'cust-1',
      ...CURRENT,
      email: 'old@x.at',
    });
    h.prisma.customer.update.mockResolvedValue({ id: 'cust-1' });
  });

  it('withdraws the confirmation when the overwriting update changes the address', async () => {
    arrangeOverwrite('neu@x.at', null);

    await h.service.applyJob(JOB_ID);

    expect(h.prisma.customer.update).toHaveBeenCalledWith({
      where: { id: 'cust-1' },
      data: expect.objectContaining({
        email: 'neu@x.at',
        contact_email_ok: false,
      }),
    });
  });

  it('keeps the confirmation when the update leaves the address as it was', async () => {
    arrangeOverwrite('old@x.at', '555');

    await h.service.applyJob(JOB_ID);

    const data = h.prisma.customer.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ phone: '555' });
    expect(data).not.toHaveProperty('contact_email_ok');
  });
});

import request from 'supertest';
import {
  createSalesInvoiceSuite,
  disposeSalesInvoiceSuite,
  type SalesInvoiceSuite,
} from './helpers/sales-invoice-suite.js';

describe('Invoice numbering concurrency (e2e)', () => {
  let suite: SalesInvoiceSuite;
  const originalWriterFlag = process.env.INVOICE_BRANDING_WRITER_ENABLED;

  beforeAll(async () => {
    process.env.INVOICE_BRANDING_WRITER_ENABLED = 'true';
    suite = await createSalesInvoiceSuite();
  });

  afterAll(async () => {
    if (originalWriterFlag === undefined) {
      delete process.env.INVOICE_BRANDING_WRITER_ENABLED;
    } else {
      process.env.INVOICE_BRANDING_WRITER_ENABLED = originalWriterFlag;
    }
    await disposeSalesInvoiceSuite(suite);
  });

  // AUT-1008 Scenario 5 & Anti-criterion 1: 20 parallel finalizations produce unique, gapless numbers
  it('assigns unique and gapless invoice numbers when 20 invoices finalize in parallel', async () => {
    const { app, prisma, authToken, customerId, catalogItemId } = suite;
    const count = 20;
    const invoiceIds: string[] = [];

    for (let i = 0; i < count; i += 1) {
      const orderRes = await request(app.getHttpServer())
        .post('/api/sales-orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customer_id: customerId,
          items: [
            {
              catalog_item_id: catalogItemId,
              description: `Concurrent item ${i + 1}`,
              quantity: 1,
              unit_price: 20,
              tax_rate: 20,
            },
          ],
        })
        .expect(201);

      await prisma.salesOrder.updateMany({
        where: { id: orderRes.body.id },
        data: { status: 'CONFIRMED' },
      });

      const draftRes = await request(app.getHttpServer())
        .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      invoiceIds.push(draftRes.body.id);
    }

    const responses = await Promise.all(
      invoiceIds.map((invoiceId) =>
        request(app.getHttpServer())
          .put(`/api/sales/invoices/${invoiceId}/finalize`)
          .set('Authorization', `Bearer ${authToken}`),
      ),
    );

    expect(responses.map((res) => res.status)).toEqual(
      Array(count).fill(200),
    );

    const numbers = responses.map((res) => res.body.invoice_number as string);
    expect(new Set(numbers).size).toBe(count);

    const sequenceNumbers = numbers
      .map((num) => Number(num.split('-').at(-1)))
      .sort((a, b) => a - b);

    const expectedStart = sequenceNumbers[0];
    expect(sequenceNumbers).toEqual(
      Array.from({ length: count }, (_, idx) => expectedStart + idx),
    );
  });
});

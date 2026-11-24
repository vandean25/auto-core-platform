import request from 'supertest';
import { SCOPE_CONTEXT_HEADER } from '../src/auth/scope-context/scope-context.constants.js';
import { mintListScopeContext } from './helpers/list-scope-context.js';
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
    if (originalWriterFlag === undefined) delete process.env.INVOICE_BRANDING_WRITER_ENABLED;
    else process.env.INVOICE_BRANDING_WRITER_ENABLED = originalWriterFlag;
    await disposeSalesInvoiceSuite(suite);
  });

  async function createDraftInvoice(description: string) {
    const { app, authToken, customerId, catalogItemId } = suite;
    const api = request(app.getHttpServer());
    const orderRes = await api
      .post('/api/sales-orders')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        customer_id: customerId,
        items: [
          {
            catalog_item_id: catalogItemId,
            description,
            quantity: 1,
            unit_price: 20,
            tax_rate: 20,
          },
        ],
      })
      .expect(201);

    await api
      .patch(`/api/sales-orders/${orderRes.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ status: 'CONFIRMED' })
      .expect(200);

    return api
      .post(`/api/sales-orders/${orderRes.body.id}/create-invoice`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(201);
  }

  it('keeps distinct draft numbers across repeated reads without consuming fiscal numbers for concurrent drafts', async () => {
    const { app, prisma, tenantId, authToken } = suite;
    const sequenceQuery = {
      where: { tenant_id: tenantId },
      orderBy: { year: 'asc' as const },
      select: { year: true, current: true },
    };
    const sequenceBefore = await prisma.invoiceSequence.findMany(sequenceQuery);
    const drafts = await Promise.all([
      createDraftInvoice('First concurrent draft'),
      createDraftInvoice('Second concurrent draft'),
    ]);

    expect(new Set(drafts.map(({ body }) => body.draft_number)).size).toBe(2);
    for (const { body } of drafts) {
      expect(body.draft_number).toMatch(/^RE-D-[1-9]\d*$/);
      expect(body.draft_number).not.toBe(body.id);
      expect(body.invoice_number).toBeNull();
    }

    const { scopeContext } = await mintListScopeContext(app, authToken);
    for (let read = 0; read < 2; read += 1) {
      const listRes = await request(app.getHttpServer())
        .get('/api/sales/invoices')
        .query({ pagination: 'cursor', limit: 100 })
        .set('Authorization', `Bearer ${authToken}`)
        .set(SCOPE_CONTEXT_HEADER, scopeContext)
        .expect(200);
      for (const { body } of drafts) {
        const expected = {
          id: body.id,
          draft_number: body.draft_number,
          invoice_number: null,
          status: 'DRAFT',
        };
        const detailRes = await request(app.getHttpServer())
          .get(`/api/sales/invoices/${body.id}`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
        expect(detailRes.body).toMatchObject(expected);
        expect(listRes.body.data).toEqual(
          expect.arrayContaining([expect.objectContaining(expected)]),
        );
      }
    }
    expect(await prisma.invoiceSequence.findMany(sequenceQuery)).toEqual(
      sequenceBefore,
    );
  });

  // AUT-1008 Scenario 5 & Anti-criterion 1: 20 parallel finalizations produce unique, gapless numbers
  it('assigns unique and gapless invoice numbers when 20 invoices finalize in parallel', async () => {
    const { app, authToken } = suite;
    const count = 20;
    const drafts: Array<{ id: string; draft_number: string }> = [];

    for (let i = 0; i < count; i += 1) {
      const draftRes = await createDraftInvoice(`Concurrent item ${i + 1}`);
      drafts.push(draftRes.body);
    }

    const responses = await Promise.all(
      drafts.map(({ id }) =>
        request(app.getHttpServer())
          .put(`/api/sales/invoices/${id}/finalize`)
          .set('Authorization', `Bearer ${authToken}`),
      ),
    );

    expect(responses.map((res) => res.status)).toEqual(
      Array(count).fill(200),
    );

    responses.forEach(({ body }, index) => {
      expect(body.draft_number).toMatch(/^RE-D-[1-9]\d*$/);
      expect(body.draft_number).toBe(drafts[index].draft_number);
      expect(body.invoice_number).toMatch(/^RE-\d{4}-\d+$/);
      expect(body.invoice_number).not.toBe(body.draft_number);
    });
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

import { test, expect } from '@playwright/test';
import { AutoCorePage } from './pom/AutoCorePage';
import {
  createMockCreditNote,
  createMockInvoiceCreditContext,
  createMockListResponse,
} from './utils/mock-factories';

const INVOICE_ID = 'invoice-cn-1';
const CREDIT_NOTE_ID = 'credit-note-draft-1';
const INVOICE_ITEM_ID = 'invoice-item-1';

const finalizedInvoice = {
  id: INVOICE_ID,
  invoice_number: 'RE-2026-0042',
  status: 'FINALIZED',
  date: '2026-09-21T00:00:00.000Z',
  due_date: '2026-10-05T00:00:00.000Z',
  total_net: '100.00',
  total_tax: '20.00',
  total_gross: '120.00',
  tax_mode: 'STANDARD',
  workshop_order_id: null,
  customer: {
    id: 'customer-1',
    type: 'PRIVATE',
    first_name: 'Jane',
    last_name: 'Doe',
    company_name: null,
    email: 'jane@example.com',
    phone: null,
  },
  items: [
    {
      id: INVOICE_ITEM_ID,
      description: 'Oil Filter',
      quantity: '2',
      unit_price: '50',
      tax_rate: '20',
      line_discount_type: null,
      line_discount_value: null,
      line_total: '100',
      revenue_group_name: 'Parts',
    },
  ],
};

test.describe('Credit notes UI', () => {
  test('happy path: create draft from invoice detail and autosave on credit note detail', async ({
    page,
  }) => {
    const draftCredit = createMockCreditNote({
      id: CREDIT_NOTE_ID,
      originalInvoiceId: INVOICE_ID,
      status: 'DRAFT',
      version: 1,
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${INVOICE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(finalizedInvoice),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/invoices/${INVOICE_ID}/credit-notes`),
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(draftCredit),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockInvoiceCreditContext()),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/credit-notes/${CREDIT_NOTE_ID}`),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          await new Promise((resolve) => setTimeout(resolve, 150));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              ...draftCredit,
              reason: 'Updated correction reason',
              version: 2,
            }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(draftCredit),
        });
      },
    );

    await page.goto(`/sales/invoices/${INVOICE_ID}`);
    await expect(page.getByRole('button', { name: /Credit Note/i })).toBeVisible();
    await page.getByRole('button', { name: /Credit Note/i }).click();
    await page.getByLabel('Reason').fill('Wrong quantity billed');
    await page.getByRole('button', { name: 'Create Draft' }).click();

    await expect(page).toHaveURL(`/finance/credit-notes/${CREDIT_NOTE_ID}`);
    const corePage = new AutoCorePage(page, 'Credit Note');
    const autoSavePromise = corePage.waitForAutoSave('/api/credit-notes');
    await page.getByLabel('Reason').fill('Updated correction reason');
    await autoSavePromise;
  });

  test('blocked: draft original invoice hides credit note action', async ({ page }) => {
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${INVOICE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...finalizedInvoice, status: 'DRAFT' }),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/invoices/${INVOICE_ID}/credit-notes`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockInvoiceCreditContext()),
        });
      },
    );

    await page.goto(`/sales/invoices/${INVOICE_ID}`);
    await expect(page.getByRole('button', { name: /Credit Note/i })).toHaveCount(0);
  });

  test('blocked: locked fiscal date returns actionable error on create', async ({ page }) => {
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${INVOICE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(finalizedInvoice),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/invoices/${INVOICE_ID}/credit-notes`),
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 422,
            contentType: 'application/json',
            body: JSON.stringify({
              code: 'FISCAL_PERIOD_LOCKED',
              message: 'Fiscal period is locked for the selected date.',
            }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockInvoiceCreditContext()),
        });
      },
    );

    await page.goto(`/sales/invoices/${INVOICE_ID}`);
    await page.getByRole('button', { name: /Credit Note/i }).click();
    await page.getByLabel('Reason').fill('Locked period attempt');
    await page.getByRole('button', { name: 'Create Draft' }).click();
    await expect(page.getByText(/Fiscal period is locked/i)).toBeVisible();
  });

  test('blocked: over-credit finalize conflict surfaces error', async ({ page }) => {
    const staleDraft = createMockCreditNote({
      id: CREDIT_NOTE_ID,
      originalInvoiceId: INVOICE_ID,
      status: 'DRAFT',
      version: 2,
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/credit-notes/${CREDIT_NOTE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(staleDraft),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${INVOICE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(finalizedInvoice),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/credit-notes/${CREDIT_NOTE_ID}/finalize`),
      async (route) => {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'CREDIT_LIMIT_EXCEEDED',
            message: 'Credit quantity exceeds remaining balance.',
          }),
        });
      },
    );

    await page.goto(`/finance/credit-notes/${CREDIT_NOTE_ID}`);
    await page.getByRole('button', { name: 'Finalize' }).click();
    await page.getByRole('button', { name: 'Finalize credit note' }).click();
    await expect(page.getByText(/exceeds remaining balance/i)).toBeVisible();
  });

  test('blocked: margin invoice only allows full credit in dialog', async ({ page }) => {
    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${INVOICE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...finalizedInvoice,
            tax_mode: 'MARGIN_SCHEME',
          }),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/invoices/${INVOICE_ID}/credit-notes`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockInvoiceCreditContext()),
        });
      },
    );

    await page.goto(`/sales/invoices/${INVOICE_ID}`);
    await page.getByRole('button', { name: /Credit Note/i }).click();
    await expect(
      page.getByText(/Margin-scheme invoices only support full-document credits/i),
    ).toBeVisible();
  });

  test('partial create sends credited line quantities', async ({ page }) => {
    const draftCredit = createMockCreditNote({
      id: CREDIT_NOTE_ID,
      originalInvoiceId: INVOICE_ID,
      status: 'DRAFT',
      version: 1,
      items: [
        {
          id: 'credit-item-1',
          originalInvoiceItemId: INVOICE_ITEM_ID,
          quantity: '1.000',
          snapshot: null,
        },
      ],
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${INVOICE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(finalizedInvoice),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/invoices/${INVOICE_ID}/credit-notes`),
      async (route) => {
        if (route.request().method() === 'POST') {
          const payload = route.request().postDataJSON() as {
            mode: string;
            lines?: Array<{ originalItemId: string; quantity: string }>;
          };
          expect(payload.mode).toBe('PARTIAL');
          expect(payload.lines).toEqual([
            { originalItemId: INVOICE_ITEM_ID, quantity: '1' },
          ]);
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify(draftCredit),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockInvoiceCreditContext()),
        });
      },
    );

    await page.goto(`/sales/invoices/${INVOICE_ID}`);
    await page.getByRole('button', { name: /Credit Note/i }).click();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: /Partial credit/i }).click();
    await page.locator('table input').fill('1');
    await page.getByLabel('Reason').fill('Partial correction');
    await page.getByRole('button', { name: 'Create Draft' }).click();
    await expect(page).toHaveURL(`/finance/credit-notes/${CREDIT_NOTE_ID}`);
  });

  test('finalize success downloads credit note PDF', async ({ page }) => {
    const draftCredit = createMockCreditNote({
      id: CREDIT_NOTE_ID,
      originalInvoiceId: INVOICE_ID,
      status: 'DRAFT',
      version: 2,
    });
    const finalizedCredit = createMockCreditNote({
      id: CREDIT_NOTE_ID,
      originalInvoiceId: INVOICE_ID,
      status: 'FINALIZED',
      creditNumber: 'CN-2026-0001',
      version: 3,
    });
    let currentCredit = draftCredit;

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/credit-notes/${CREDIT_NOTE_ID}`),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          currentCredit = { ...draftCredit, version: 3 };
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(currentCredit),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(currentCredit),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${INVOICE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(finalizedInvoice),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/credit-notes/${CREDIT_NOTE_ID}/finalize`),
      async (route) => {
        currentCredit = finalizedCredit;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(finalizedCredit),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/credit-notes/${CREDIT_NOTE_ID}/pdf`),
      async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              mode: 'generated',
              creditNoteId: CREDIT_NOTE_ID,
            }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/pdf',
          body: Buffer.from('%PDF-1.4 credit-note'),
        });
      },
    );

    await page.goto(`/finance/credit-notes/${CREDIT_NOTE_ID}`);
    await page.getByRole('button', { name: 'Finalize' }).click();
    await page.getByRole('button', { name: 'Finalize credit note' }).click();
    await expect(page.getByText(/Credit note finalized/i)).toBeVisible();

    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
    await page.getByRole('button', { name: 'Print' }).click();
    await expect(page.getByText(/PDF downloaded successfully/i)).toBeVisible();
    await expect(
      page.getByText(/Contact support and your accountant/i),
    ).toBeVisible();
  });

  test('autosave failure blocks finalize', async ({ page }) => {
    const staleDraft = createMockCreditNote({
      id: CREDIT_NOTE_ID,
      originalInvoiceId: INVOICE_ID,
      status: 'DRAFT',
      version: 1,
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/credit-notes/${CREDIT_NOTE_ID}`),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Autosave failed' }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(staleDraft),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${INVOICE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(finalizedInvoice),
        });
      },
    );

    await page.goto(`/finance/credit-notes/${CREDIT_NOTE_ID}`);
    await page.getByLabel('Reason').fill('Trigger autosave failure');
    await expect(page.getByText(/Auto-save failed/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finalize' })).toBeDisabled();
  });

  test('non-admin users cannot create credit notes from invoice detail', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('e2e-active-role', 'SALES');
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${INVOICE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(finalizedInvoice),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/invoices/${INVOICE_ID}/credit-notes`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(createMockInvoiceCreditContext()),
        });
      },
    );

    await page.goto(`/sales/invoices/${INVOICE_ID}`);
    await expect(page.getByRole('button', { name: /Credit Note/i })).toHaveCount(0);
    await expect(
      page.getByText(/Credit notes can only be issued by OWNER or ADMIN/i),
    ).toBeVisible();
  });

  test('non-admin users see read-only draft credit note detail', async ({ page }) => {
    const draftCredit = createMockCreditNote({
      id: CREDIT_NOTE_ID,
      originalInvoiceId: INVOICE_ID,
      status: 'DRAFT',
      version: 1,
    });
    let patchRequestCount = 0;

    await page.addInitScript(() => {
      window.localStorage.setItem('e2e-active-role', 'SALES');
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/credit-notes/${CREDIT_NOTE_ID}`),
      async (route) => {
        if (route.request().method() === 'PATCH') {
          patchRequestCount += 1;
          await route.fulfill({
            status: 403,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Forbidden' }),
          });
          return;
        }

        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(draftCredit),
        });
      },
    );

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/sales/invoices/${INVOICE_ID}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(finalizedInvoice),
        });
      },
    );

    await page.goto(`/finance/credit-notes/${CREDIT_NOTE_ID}`);
    await expect(
      page.getByText(/Only OWNER or ADMIN can edit or void this draft credit note/i),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finalize' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Void' })).toHaveCount(0);
    await expect(page.getByLabel('Reason')).toHaveCount(0);
    await page.getByText('Wrong quantity billed').click();
    await page.waitForTimeout(1000);
    expect(patchRequestCount).toBe(0);
  });

  test('credit notes list page follows golden rules', async ({ page }) => {
    const corePage = new AutoCorePage(page, 'Credit Note');
    const creditNote = createMockCreditNote({
      creditNumber: 'CN-2026-0001',
      status: 'FINALIZED',
    });

    await page.route(AutoCorePage.apiRouteMatcher('/api/credit-notes'), async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(createMockListResponse([creditNote])),
      });
    });

    await page.route(
      AutoCorePage.apiRouteMatcher(`/api/credit-notes/${creditNote.id}`),
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(creditNote),
        });
      },
    );

    await corePage.navigate('/finance/credit-notes');
    await expect(
      page.getByRole('heading', { name: 'Credit Notes', exact: true }),
    ).toBeVisible();
    await corePage.openRowDetails('CN-2026-0001');
    await expect(page).toHaveURL(`/finance/credit-notes/${creditNote.id}`);
  });
});

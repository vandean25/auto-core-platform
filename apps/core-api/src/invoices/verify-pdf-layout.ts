import { PlaywrightBrowserService } from '../common';
import { InvoicePdfRenderer } from './invoice-pdf.renderer';
import { CustomerType } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

async function generatePDFs() {
  const browserService = new PlaywrightBrowserService();
  const renderer = new InvoicePdfRenderer(browserService);

  // Use process.cwd() to ensure reliable output path relative to project root
  const outputDir = path.resolve(process.cwd(), 'pdf-verification');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const baseSnapshot = {
    id: 'inv-risk-001',
    invoice_number: 'INV-RISK-001',
    date: new Date().toISOString(),
    due_date: new Date().toISOString(),
    total_net: '1000.00',
    total_tax: '200.00',
    total_gross: '1200.00',
    notes: 'Standard notes',
    customer: {
      type: CustomerType.COMPANY,
      company_name: 'Risk Corp',
      first_name: 'Jane',
      last_name: 'Doe',
      email: 'jane@riskcorp.com',
      phone: null,
      vat_id: 'VAT123456789',
      address_street: '123 Main St',
      address_city: 'City',
      address_zip: '12345',
      address_country: 'Country',
    },
    vehicle: null,
    items: [],
    snapshot_created_at: new Date().toISOString(),
  };

  async function renderToFile(name: string, snapshot: any) {
    const pdf = await renderer.render(snapshot);
    fs.writeFileSync(path.join(outputDir, name), pdf);
    console.log(`Generated ${name} in ${outputDir}`);
  }

  // 1. Multi-page: Invoice with 150 line items.
  const multiPageSnapshot = {
    ...baseSnapshot,
    id: 'inv-multi-page',
    invoice_number: 'INV-MULTI-PAGE',
    total_net: '1500.00',
    total_tax: '300.00',
    total_gross: '1800.00',
    items: Array.from({ length: 150 }).map((_, i) => ({
      description: `Item ${i + 1}`,
      quantity: '1.00',
      unit_price: '10.00',
      tax_rate: '20.00',
      line_discount_type: null,
      line_discount_value: null,
      line_total: '12.00',
      revenue_group_name: null,
    })),
  };

  // 2. Long Content: Extremely long descriptions and customer address strings.
  const longContentSnapshot = {
    ...baseSnapshot,
    id: 'inv-long-content',
    invoice_number: 'INV-LONG-CONTENT',
    customer: {
      ...baseSnapshot.customer,
      company_name:
        'Very Long Company Name That Might Span Multiple Lines And Cause Layout Issues If Not Handled Properly Limited Liability Company',
      address_street:
        '12345 Extremely Long Street Name Boulevard Avenue, Suite 987654321, Floor 99, Building Z, Complex Alpha Beta Gamma',
    },
    items: [
      {
        description:
          'This is an extremely long item description that goes on and on to test how the PDF renderer handles wrapping text in the table cells. It should not break the table layout or overflow into other columns.',
        quantity: '1.00',
        unit_price: '1000.00',
        tax_rate: '20.00',
        line_discount_type: null,
        line_discount_value: null,
        line_total: '1200.00',
        revenue_group_name: null,
      },
    ],
  };

  // 3. Legal Compliance: Explicitly verify visibility of Company VAT ID and Sequence Numbering.
  const legalComplianceSnapshot = {
    ...baseSnapshot,
    id: 'inv-legal-compliance',
    invoice_number: 'SEQ-2023-99999',
    customer: {
      ...baseSnapshot.customer,
      vat_id: 'GB123456789 (VAT Registered)',
    },
    items: [
      {
        description: 'Legal Consultation',
        quantity: '1.00',
        unit_price: '500.00',
        tax_rate: '20.00',
        line_discount_type: null,
        line_discount_value: null,
        line_total: '600.00',
        revenue_group_name: null,
      },
    ],
    total_net: '500.00',
    total_tax: '100.00',
    total_gross: '600.00',
  };

  await renderToFile('multi-page.pdf', multiPageSnapshot);
  await renderToFile('long-content.pdf', longContentSnapshot);
  await renderToFile('legal-compliance.pdf', legalComplianceSnapshot);
  await browserService.onModuleDestroy();
}

// Add a guard to prevent execution when imported
if (require.main === module) {
  generatePDFs()
    .then(() => {
      console.log('Verification PDF generation complete.');
    })
    .catch((err) => {
      console.error('Unexpected error in verify-pdf-layout script:', err);
      process.exit(1);
    });
}

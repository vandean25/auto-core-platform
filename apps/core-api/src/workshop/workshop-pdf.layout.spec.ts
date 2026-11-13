import { Prisma } from '@prisma/client';
import { escapeHtml } from '../common/pdf/pdf-layout.js';
import {
  buildWorkshopCustomerSection,
  buildWorkshopDocumentStyles,
  buildWorkshopFooterNotes,
  buildWorkshopFooterTemplate,
  buildWorkshopHeader,
  buildWorkshopHtmlDocument,
  buildWorkshopInternalNotesSection,
  buildWorkshopReportedIssueSection,
  buildWorkshopTasksSection,
  buildWorkshopVehicleSection,
} from './workshop-pdf.layout.js';
import { getWorkshopPdfCopy } from './workshop-pdf-copy.js';
import type { WorkshopOrderForPdf } from './workshop-pdf.types.js';

describe('workshop-pdf.layout', () => {
  const deCopy = getWorkshopPdfCopy('de');
  const enCopy = getWorkshopPdfCopy('en', 'localized');
  const createBaseOrder = (): WorkshopOrderForPdf => ({
    id: 'order-123',
    order_number: 'WO-100',
    status: 'INTAKE',
    odometer: 45000,
    fuel_level: 80,
    reported_issue: 'Squeaking brakes',
    notes: 'Urgent customer request',
    customer: {
      type: 'PRIVATE',
      first_name: 'Max',
      last_name: 'Mustermann',
      company_name: null,
      phone: '+431234567',
      email: 'max@example.com',
      address_zip: '1010',
      address_city: 'Wien',
      preferred_language: null,
    },
    vehicle: {
      make: 'Audi',
      model: 'A4',
      year: 2021,
      vin: 'WAUZZZ12345',
      plate: 'W-9999X',
    },
    tasks: [
      {
        title: 'Brake Inspection',
        mechanic_notes: 'Check front pads',
        line_items: [
          {
            type: 'PART',
            item_no: 'PAD-01',
            description: 'Brake Pad Set',
            quantity: '1',
          },
        ],
      },
    ],
  });

  describe('buildWorkshopDocumentStyles', () => {
    it('contains document styles', () => {
      const styles = buildWorkshopDocumentStyles();
      expect(styles).toContain('.badge-jobcard');
      expect(styles).toContain('.task-card');
      expect(styles).toContain('.issue-box');
    });
  });

  describe('buildWorkshopHeader', () => {
    it('renders job card header with order number', () => {
      const header = buildWorkshopHeader('WO-100', enCopy);
      expect(header).toContain('Job Card');
      expect(header).toContain('Order: WO-100');
      expect(header).toContain('Internal Document');
    });
  });

  describe('buildWorkshopCustomerSection', () => {
    it('renders private customer with full name and details', () => {
      const customer = createBaseOrder().customer;
      const html = buildWorkshopCustomerSection(customer, escapeHtml, enCopy);
      expect(html).toContain('Max Mustermann');
      expect(html).toContain('1010 Wien');
      expect(html).toContain('Phone: +431234567');
      expect(html).toContain('Email: max@example.com');
    });

    it('renders company name for COMPANY customer', () => {
      const customer = {
        ...createBaseOrder().customer!,
        type: 'COMPANY' as const,
        company_name: 'Acme Motors GmbH',
      };
      const html = buildWorkshopCustomerSection(customer, escapeHtml, enCopy);
      expect(html).toContain('Acme Motors GmbH');
    });

    it('renders dash placeholder when customer name is empty', () => {
      const customer = {
        ...createBaseOrder().customer!,
        first_name: '',
        last_name: '',
        company_name: null,
        address_zip: null,
        address_city: null,
        phone: null,
        email: null,
      };
      const html = buildWorkshopCustomerSection(customer, escapeHtml, enCopy);
      expect(html).toContain('>—<');
    });
  });

  describe('buildWorkshopVehicleSection', () => {
    it('renders vehicle information with odometer and fuel level', () => {
      const order = createBaseOrder();
      const html = buildWorkshopVehicleSection(
        order.vehicle,
        order.odometer,
        order.fuel_level,
        escapeHtml,
        enCopy,
      );
      expect(html).toContain('Audi A4 (2021)');
      expect(html).toContain(
        'VIN: <span style="font-family: monospace;">WAUZZZ12345</span>',
      );
      expect(html).toContain('Plate: <strong>W-9999X</strong>');
      expect(html).toContain('45000 km');
      expect(html).toContain('80%');
    });

    it('renders dashes when make/model or stats are missing', () => {
      const html = buildWorkshopVehicleSection(
        { make: '', model: '', year: 2021, vin: null, plate: null },
        null,
        null,
        escapeHtml,
        enCopy,
      );
      expect(html).toContain('— — (');
      expect(html).toContain('>—</div>');
    });
  });

  describe('buildWorkshopReportedIssueSection', () => {
    it('returns empty string when reported issue is not present', () => {
      expect(buildWorkshopReportedIssueSection(null, escapeHtml, enCopy)).toBe(
        '',
      );
      expect(buildWorkshopReportedIssueSection('', escapeHtml, enCopy)).toBe(
        '',
      );
    });

    it('renders reported issue box when present', () => {
      const html = buildWorkshopReportedIssueSection(
        'Engine vibrates',
        escapeHtml,
        enCopy,
      );
      expect(html).toContain('Reported Issue / Customer Complaint');
      expect(html).toContain('Engine vibrates');
    });
  });

  describe('buildWorkshopTasksSection', () => {
    it('renders fallback when no tasks exist', () => {
      const html = buildWorkshopTasksSection([], escapeHtml, enCopy);
      expect(html).toContain('No tasks assigned yet.');
    });

    it('renders tasks and line items table', () => {
      const order = createBaseOrder();
      const html = buildWorkshopTasksSection(order.tasks, escapeHtml, enCopy);
      expect(html).toContain('Brake Inspection');
      expect(html).toContain('Mechanic Notes:');
      expect(html).toContain('Check front pads');
      expect(html).toContain('PAD-01');
      expect(html).toContain('Brake Pad Set');
    });

    // AUT-985 Scenario 1: LABOR line with Prisma.Decimal / quoted string qty renders unquoted
    it('renders LABOR line stored Decimal or quoted string qty without quotes', () => {
      const html = buildWorkshopTasksSection(
        [
          {
            title: 'Labor Task',
            mechanic_notes: null,
            line_items: [
              {
                type: 'LABOR',
                item_no: 'LAB-01',
                description: 'Diagnostics',
                quantity: new Prisma.Decimal('2'),
              },
              {
                type: 'LABOR',
                item_no: 'LAB-02',
                description: 'Alignment',
                quantity: '"3"',
              },
            ],
          },
        ],
        escapeHtml,
        deCopy,
        'de',
      );
      expect(html).toContain('<td style="text-align: right">2</td>');
      expect(html).toContain('<td style="text-align: right">3</td>');
      expect(html).not.toContain('&quot;2&quot;');
      expect(html).not.toContain('&quot;3&quot;');
    });

    // AUT-985 Scenario 2: numeric qty renders the same value as today
    it('renders numeric qty as plain number', () => {
      const html = buildWorkshopTasksSection(
        [
          {
            title: 'Numeric Task',
            mechanic_notes: null,
            line_items: [
              {
                type: 'PART',
                item_no: 'PART-01',
                description: 'Oil Filter',
                quantity: 2,
              },
            ],
          },
        ],
        escapeHtml,
        deCopy,
        'de',
      );
      expect(html).toContain('<td style="text-align: right">2</td>');
    });

    // AUT-985 Scenario 3: decimal qty 1.5 in DE locale renders 1,5
    it('formats decimal qty 1.5 with comma in DE locale', () => {
      const html = buildWorkshopTasksSection(
        [
          {
            title: 'Decimal Task',
            mechanic_notes: null,
            line_items: [
              {
                type: 'LABOR',
                item_no: 'LAB-03',
                description: 'Electrical repair',
                quantity: new Prisma.Decimal('1.5'),
              },
            ],
          },
        ],
        escapeHtml,
        deCopy,
        'de',
      );
      expect(html).toContain('<td style="text-align: right">1,5</td>');
    });

    // AUT-985 Scenario 4: mixed LABOR and PART lines format all MENGE values uniformly
    it('formats mixed LABOR and PART line quantities uniformly without quotes', () => {
      const html = buildWorkshopTasksSection(
        [
          {
            title: 'Mixed Task',
            mechanic_notes: null,
            line_items: [
              {
                type: 'LABOR',
                item_no: 'LAB-10',
                description: 'Mount tyres',
                quantity: new Prisma.Decimal('2'),
              },
              {
                type: 'PART',
                item_no: 'TYRE-10',
                description: 'Winter tyre',
                quantity: 1.5,
              },
            ],
          },
        ],
        escapeHtml,
        deCopy,
        'de',
      );
      expect(html).toContain('<td style="text-align: right">2</td>');
      expect(html).toContain('<td style="text-align: right">1,5</td>');
      expect(html).not.toContain('&quot;');
    });
  });

  describe('buildWorkshopInternalNotesSection', () => {
    it('returns empty string when notes are absent', () => {
      expect(buildWorkshopInternalNotesSection(null, escapeHtml, enCopy)).toBe(
        '',
      );
    });

    it('renders internal notes when present', () => {
      const html = buildWorkshopInternalNotesSection(
        'Keep until 5pm',
        escapeHtml,
        enCopy,
      );
      expect(html).toContain('Internal Notes');
      expect(html).toContain('Keep until 5pm');
    });
  });

  describe('buildWorkshopFooterNotes and buildWorkshopFooterTemplate', () => {
    it('renders footer signature line', () => {
      const html = buildWorkshopFooterNotes(enCopy);
      expect(html).toContain("Mechanic's signature:");
    });

    it('renders footer template for Playwright with safe order number', () => {
      const template = buildWorkshopFooterTemplate(
        'WO-100',
        escapeHtml,
        'en',
        'localized',
      );
      expect(template).toContain('Job Card WO-100');
      expect(template).toContain('class="pageNumber"');
      expect(template).toContain('class="totalPages"');
      expect(template).toContain('Page <span class="pageNumber"></span> of');
    });
  });

  describe('buildWorkshopHtmlDocument', () => {
    it('assembles the full HTML document correctly', () => {
      const order = createBaseOrder();
      const html = buildWorkshopHtmlDocument(
        order,
        'WO-100',
        escapeHtml,
        'en',
        'localized',
      );
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('lang="en"');
      expect(html).toContain('Job Card');
      expect(html).toContain('Max Mustermann');
      expect(html).toContain('Audi A4');
      expect(html).toContain('Brake Inspection');
      expect(html).toContain('Urgent customer request');
    });

    it('uses German labels when document locale is de', () => {
      const order = createBaseOrder();
      const html = buildWorkshopHtmlDocument(order, 'WO-100', escapeHtml, 'de');
      expect(html).toContain('lang="de"');
      expect(html).toContain('Arbeitskarte');
      expect(html).toContain(deCopy.customerSectionTitle);
      expect(html).not.toContain('Job Card');
    });
  });
});

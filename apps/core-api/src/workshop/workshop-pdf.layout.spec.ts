import { escapeHtml } from '../common/pdf/pdf-layout';
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
} from './workshop-pdf.layout';
import type { WorkshopOrderForPdf } from './workshop-pdf.types';

describe('workshop-pdf.layout', () => {
  const createBaseOrder = (): WorkshopOrderForPdf => ({
    id: 'order-123',
    tenant_id: 'tenant-1',
    order_number: 'WO-100',
    status: 'INTAKE',
    odometer: 45000,
    fuel_level: 80,
    reported_issue: 'Squeaking brakes',
    notes: 'Urgent customer request',
    customer: {
      id: 'cust-1',
      tenant_id: 'tenant-1',
      type: 'PRIVATE',
      first_name: 'Max',
      last_name: 'Mustermann',
      company_name: null,
      phone: '+431234567',
      email: 'max@example.com',
      address_zip: '1010',
      address_city: 'Wien',
      address_street: 'Hauptstraße 1',
      address_country: 'Austria',
      vat_id: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    vehicle: {
      id: 'veh-1',
      tenant_id: 'tenant-1',
      make: 'Audi',
      model: 'A4',
      year: 2021,
      vin: 'WAUZZZ12345',
      plate: 'W-9999X',
      color: null,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    tasks: [
      {
        id: 'task-1',
        workshop_order_id: 'order-123',
        tenant_id: 'tenant-1',
        title: 'Brake Inspection',
        status: 'IN_PROGRESS',
        order_index: 0,
        mechanic_notes: 'Check front pads',
        line_items_version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        line_items: [
          {
            id: 'line-1',
            task_id: 'task-1',
            tenant_id: 'tenant-1',
            type: 'PART',
            item_no: 'PAD-01',
            description: 'Brake Pad Set',
            quantity: '1',
            unit_price: '85.00',
            part_execution_status: null,
            labor_operation_id: null,
            standard_aw: null,
            actual_hours: null,
            internal_cost_rate: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    ],
    customer_id: 'cust-1',
    vehicle_id: 'veh-1',
    purpose: 'CUSTOMER_REPAIR',
    priority: 'NORMAL',
    color_label: null,
    source: null,
    requested_delivery_date: null,
    estimated_delivery_date: null,
    actual_delivery_date: null,
    assigned_user_id: null,
    invoice_id: null,
    pdf_storage_bucket: null,
    pdf_storage_key: null,
    pdf_generated_at: null,
    pdf_generation_error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
      const header = buildWorkshopHeader('WO-100');
      expect(header).toContain('Job Card');
      expect(header).toContain('Order: WO-100');
      expect(header).toContain('Internal Document');
    });
  });

  describe('buildWorkshopCustomerSection', () => {
    it('renders private customer with full name and details', () => {
      const customer = createBaseOrder().customer;
      const html = buildWorkshopCustomerSection(customer, escapeHtml);
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
      const html = buildWorkshopCustomerSection(customer, escapeHtml);
      expect(html).toContain('Acme Motors GmbH');
    });

    it('renders dash placeholder when customer name is empty', () => {
      const customer = {
        ...createBaseOrder().customer!,
        first_name: null,
        last_name: null,
        company_name: null,
        address_zip: null,
        address_city: null,
        phone: null,
        email: null,
      };
      const html = buildWorkshopCustomerSection(customer, escapeHtml);
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
      );
      expect(html).toContain('Audi A4 (2021)');
      expect(html).toContain(
        'VIN: <span style="font-family: monospace;">WAUZZZ12345</span>',
      );
      expect(html).toContain('Plate: <strong>W-9999X</strong>');
      expect(html).toContain('45000 km');
      expect(html).toContain('80%');
    });

    it('renders dashes when vehicle or stats are missing', () => {
      const html = buildWorkshopVehicleSection(null, null, null, escapeHtml);
      expect(html).toContain('— — (—)');
      expect(html).toContain('>—</div>');
    });
  });

  describe('buildWorkshopReportedIssueSection', () => {
    it('returns empty string when reported issue is not present', () => {
      expect(buildWorkshopReportedIssueSection(null, escapeHtml)).toBe('');
      expect(buildWorkshopReportedIssueSection('', escapeHtml)).toBe('');
    });

    it('renders reported issue box when present', () => {
      const html = buildWorkshopReportedIssueSection(
        'Engine vibrates',
        escapeHtml,
      );
      expect(html).toContain('Reported Issue / Customer Complaint');
      expect(html).toContain('Engine vibrates');
    });
  });

  describe('buildWorkshopTasksSection', () => {
    it('renders fallback when no tasks exist', () => {
      const html = buildWorkshopTasksSection([], escapeHtml);
      expect(html).toContain('No tasks assigned yet.');
    });

    it('renders tasks and line items table', () => {
      const order = createBaseOrder();
      const html = buildWorkshopTasksSection(order.tasks, escapeHtml);
      expect(html).toContain('Brake Inspection');
      expect(html).toContain('Mechanic Notes:');
      expect(html).toContain('Check front pads');
      expect(html).toContain('PAD-01');
      expect(html).toContain('Brake Pad Set');
    });
  });

  describe('buildWorkshopInternalNotesSection', () => {
    it('returns empty string when notes are absent', () => {
      expect(buildWorkshopInternalNotesSection(null, escapeHtml)).toBe('');
    });

    it('renders internal notes when present', () => {
      const html = buildWorkshopInternalNotesSection(
        'Keep until 5pm',
        escapeHtml,
      );
      expect(html).toContain('Internal Notes');
      expect(html).toContain('Keep until 5pm');
    });
  });

  describe('buildWorkshopFooterNotes and buildWorkshopFooterTemplate', () => {
    it('renders footer signature line', () => {
      const html = buildWorkshopFooterNotes();
      expect(html).toContain('Signature Mechanic:');
    });

    it('renders footer template for Playwright with safe order number', () => {
      const template = buildWorkshopFooterTemplate('WO-100', escapeHtml);
      expect(template).toContain('Job Card WO-100');
      expect(template).toContain('class="pageNumber"');
      expect(template).toContain('class="totalPages"');
    });
  });

  describe('buildWorkshopHtmlDocument', () => {
    it('assembles the full HTML document correctly', () => {
      const order = createBaseOrder();
      const html = buildWorkshopHtmlDocument(order, 'WO-100', escapeHtml);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Job Card');
      expect(html).toContain('Max Mustermann');
      expect(html).toContain('Audi A4');
      expect(html).toContain('Brake Inspection');
      expect(html).toContain('Urgent customer request');
    });
  });
});

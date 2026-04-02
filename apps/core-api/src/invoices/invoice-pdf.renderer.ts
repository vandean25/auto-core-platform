import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { InvoiceSnapshot } from './invoice-snapshot';

@Injectable()
export class InvoicePdfRenderer {
  async render(snapshot: InvoiceSnapshot): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const bufferPromise = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const invoiceNumber = snapshot.invoice_number ?? snapshot.id;

    doc.fontSize(20).text('Invoice', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(12);
    doc.text(`Invoice number: ${invoiceNumber}`);
    doc.text(`Invoice date: ${this.formatDate(snapshot.date)}`);
    doc.text(`Due date: ${this.formatDate(snapshot.due_date)}`);
    doc.moveDown(1);

    doc.fontSize(12).text('Bill to:', { underline: true });
    doc.fontSize(11);
    doc.text(this.formatCustomerName(snapshot));
    doc.text(snapshot.customer.address_street ?? '');

    const cityLine = [
      snapshot.customer.address_zip,
      snapshot.customer.address_city,
    ]
      .filter(Boolean)
      .join(' ');
    if (cityLine) {
      doc.text(cityLine);
    }
    if (snapshot.customer.address_country) {
      doc.text(snapshot.customer.address_country);
    }
    if (snapshot.customer.vat_id) {
      doc.text(`VAT ID: ${snapshot.customer.vat_id}`);
    }
    doc.moveDown(1);

    if (snapshot.vehicle) {
      doc.fontSize(12).text('Vehicle:', { underline: true });
      doc
        .fontSize(11)
        .text(
          `${snapshot.vehicle.make} ${snapshot.vehicle.model} (${snapshot.vehicle.year})`,
        );
      if (snapshot.vehicle.plate) {
        doc.text(`Plate: ${snapshot.vehicle.plate}`);
      }
      if (snapshot.vehicle.vin) {
        doc.text(`VIN: ${snapshot.vehicle.vin}`);
      }
      doc.moveDown(1);
    }

    doc.fontSize(12).text('Items', { underline: true });
    doc.moveDown(0.5);

    const startX = doc.x;
    const qtyX = startX + 300;
    const unitX = startX + 360;
    const totalX = startX + 450;

    doc.fontSize(10);
    const headerY = doc.y;
    doc.text('Description', startX, headerY, { width: 290 });
    doc.text('Qty', qtyX, headerY, { width: 50, align: 'right' });
    doc.text('Unit', unitX, headerY, { width: 80, align: 'right' });
    doc.text('Total', totalX, headerY, { width: 90, align: 'right' });
    doc.moveDown(0.5);

    snapshot.items.forEach((item) => {
      const rowY = doc.y;
      doc.text(item.description, startX, rowY, { width: 290 });
      doc.text(item.quantity, qtyX, rowY, { width: 50, align: 'right' });
      doc.text(this.money(item.unit_price), unitX, rowY, {
        width: 80,
        align: 'right',
      });
      doc.text(this.money(item.line_total ?? ''), totalX, rowY, {
        width: 90,
        align: 'right',
      });
      doc.moveDown(0.5);
    });

    doc.moveDown(1);
    doc.fontSize(12).text('Totals', { underline: true });
    doc.fontSize(11);
    doc.text(`Net: ${this.money(snapshot.total_net)}`, { align: 'right' });
    doc.text(`Tax: ${this.money(snapshot.total_tax)}`, { align: 'right' });
    doc.text(`Gross: ${this.money(snapshot.total_gross)}`, { align: 'right' });

    if (snapshot.notes) {
      doc.moveDown(1);
      doc.fontSize(12).text('Notes', { underline: true });
      doc.fontSize(11).text(snapshot.notes);
    }

    doc.end();
    return bufferPromise;
  }

  private money(value: string) {
    if (!value) {
      return '';
    }
    return value;
  }

  private formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toISOString().slice(0, 10);
  }

  private formatCustomerName(snapshot: InvoiceSnapshot) {
    if (snapshot.customer.type === 'COMPANY') {
      return (
        snapshot.customer.company_name ??
        `${snapshot.customer.first_name} ${snapshot.customer.last_name}`
      );
    }
    return `${snapshot.customer.first_name} ${snapshot.customer.last_name}`;
  }
}

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopInvoiceService } from './workshop-invoice.service.js';
import {
  mockInvoices,
  mockPrisma,
  resetWorkshopMocks,
  workshopInvoiceProvider,
  workshopPrismaProvider,
  workshopTenantProvider,
  mockSiteContext,
} from './workshop.spec.support.js';
import { SiteContextService } from '../common/services/site-context.service.js';

describe('WorkshopInvoiceService', () => {
  let service: WorkshopInvoiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopInvoiceService,
        workshopPrismaProvider,
        workshopInvoiceProvider,
        workshopTenantProvider,
        { provide: SiteContextService, useValue: mockSiteContext },
      ],
    }).compile();

    service = module.get(WorkshopInvoiceService);
    resetWorkshopMocks();
  });
  it('delegates invoice creation to InvoicesService', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      purpose: 'CUSTOMER_REPAIR',
    });
    mockInvoices.createDraftInvoice.mockResolvedValue({ id: 'inv-1' });

    await service.createInvoiceFromOrder('wo-1');

    expect(mockInvoices.createDraftInvoice).toHaveBeenCalledWith('wo-1');
  });

  it('rejects invoicing stock-prep workshop orders', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      purpose: 'STOCK_PREP',
    });

    await expect(service.createInvoiceFromOrder('wo-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockInvoices.createDraftInvoice).not.toHaveBeenCalled();
  });
});

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkshopInvoiceService } from './workshop-invoice.service';
import {
  mockInvoices,
  mockPrisma,
  resetWorkshopMocks,
  workshopInvoiceProvider,
  workshopPrismaProvider,
  workshopTenantProvider,
} from './workshop.spec.support';

describe('WorkshopInvoiceService', () => {
  let service: WorkshopInvoiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopInvoiceService,
        workshopPrismaProvider,
        workshopInvoiceProvider,
        workshopTenantProvider,
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

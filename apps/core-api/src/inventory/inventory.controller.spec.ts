import { Test, TestingModule } from '@nestjs/testing';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { LedgerService } from './ledger.service';

describe('InventoryController', () => {
  let controller: InventoryController;
  let service: InventoryService;

  const mockInventoryService = {
    checkAvailability: jest.fn(),
    findAll: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryController],
      providers: [
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: LedgerService, useValue: { getTransactionHistory: jest.fn() } },
      ],
    }).compile();

    controller = module.get<InventoryController>(InventoryController);
    service = module.get<InventoryService>(InventoryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findAll', () => {
    it('should call inventoryService.findAll with parsed params', async () => {
      const mockResult = { data: [], meta: { total: 0, page: 1, last_page: 0 } };
      mockInventoryService.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll('2', '20', 'test', 'location');

      expect(result).toBe(mockResult);
      expect(service.findAll).toHaveBeenCalledWith({
        page: 2,
        limit: 20,
        search: 'test',
        location: 'location',
      });
    });

    it('should use default values for page and limit', async () => {
      await controller.findAll();

      expect(service.findAll).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        search: undefined,
        location: undefined,
      });
    });
  });
});

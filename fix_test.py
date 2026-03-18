import re

file_path = 'apps/core-api/src/purchase/purchase.service.spec.ts'

with open(file_path, 'r') as f:
    content = f.read()

# Update the mock for purchaseOrderItem to include findMany
old_mock = """    purchaseOrderItem: {
      update: jest.fn(),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'poi1', quantity: 10, quantity_received: 0 }),
      deleteMany: jest.fn(),
    },"""

new_mock = """    purchaseOrderItem: {
      update: jest.fn(),
      findUnique: jest
        .fn()
        .mockResolvedValue({ id: 'poi1', quantity: 10, quantity_received: 0 }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'poi1', quantity: 10, quantity_received: 0, catalog_item_id: 'item1', unit_cost: 50 },
      ]),
      deleteMany: jest.fn(),
    },"""

content = content.replace(old_mock, new_mock)

# Update mockLedgerService
old_ledger = """  const mockLedgerService = {
    recordTransaction: jest.fn(),
  };"""

new_ledger = """  const mockLedgerService = {
    recordTransaction: jest.fn(),
    recordTransactions: jest.fn(),
  };"""

content = content.replace(old_ledger, new_ledger)

# Update the receiveItems expectation since we changed the ledger call
old_expect = """      expect(mockLedgerService.recordTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          itemId: 'item1',
          quantity: 5,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 50,
        }),
        expect.anything(),
      );"""

new_expect = """      expect(mockLedgerService.recordTransactions).toHaveBeenCalledWith([
        expect.objectContaining({
          itemId: 'item1',
          quantity: 5,
          type: TransactionType.PURCHASE_RECEIPT,
          costBasis: 50,
        })],
        expect.anything(),
      );"""

content = content.replace(old_expect, new_expect)

with open(file_path, 'w') as f:
    f.write(content)

print("Test update complete")

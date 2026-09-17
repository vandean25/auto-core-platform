const siteOwnedModelFields: Readonly<Record<string, readonly string[]>> = {
  StorageLocation: ['site_id'],
  InventoryStock: ['site_id'],
  InventoryTransaction: ['site_id'],
  StockTransfer: ['from_site_id', 'to_site_id'],
  StockTransferLine: ['from_site_id', 'to_site_id'],
  PurchaseOrder: ['site_id'],
  VehiclePurchase: ['site_id'],
  VehicleSale: ['site_id'],
  SalesOrder: ['site_id'],
  Bay: ['site_id'],
  WorkshopOpeningHour: ['site_id'],
  WorkshopHoliday: ['site_id'],
  WorkshopOrder: ['site_id'],
};

type PrismaModel = {
  name: string;
  body: string;
};

function readPrismaModels(schemaContent: string): PrismaModel[] {
  const modelRegex = /model\s+([A-Z]\w+)\s*{([\s\S]*?)}/g;

  return [...schemaContent.matchAll(modelRegex)].map((match) => ({
    name: match[1],
    body: match[2],
  }));
}

export function lintPrismaSiteScopeSchema(schemaContent: string): void {
  for (const model of readPrismaModels(schemaContent)) {
    const requiredFields = siteOwnedModelFields[model.name];
    if (!requiredFields) continue;

    const missingFields = requiredFields.filter(
      (fieldName) =>
        !new RegExp(`^\\s+${fieldName}\\s+`, 'm').test(model.body),
    );

    if (missingFields.length > 0) {
      throw new Error(
        `[Lint Error] Site-owned model '${model.name}' is missing ${missingFields.join(', ')}.`,
      );
    }
  }
}

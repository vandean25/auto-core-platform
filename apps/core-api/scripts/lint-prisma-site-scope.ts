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

const siteOwnedDelegates: ReadonlySet<string> = new Set([
  'storageLocation',
  'inventoryStock',
  'inventoryTransaction',
  'stockTransfer',
  'stockTransferLine',
  'purchaseOrder',
  'vehiclePurchase',
  'vehicleSale',
  'salesOrder',
  'bay',
  'workshopOpeningHour',
  'workshopHoliday',
  'workshopOrder',
]);

const scopedPrismaOperations = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'aggregate',
  'groupBy',
]);

type SourceFile = {
  path: string;
  content: string;
};

function findCallBody(content: string, openingBraceIndex: number): string {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;

  for (let index = openingBraceIndex; index < content.length; index += 1) {
    const character = content[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }

    if (character === '{') depth += 1;
    if (character === '}' && --depth === 0) {
      return content.slice(openingBraceIndex, index + 1);
    }
  }

  return content.slice(openingBraceIndex);
}

function lineNumber(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

export function lintPrismaSiteScopeQueries(sourceFiles: readonly SourceFile[]): void {
  const queryPattern =
    /(?:this\.)?(?:prisma|tx|db|input\.db)\.(\w+)\.(findMany|findFirst|findUnique|count|aggregate|groupBy)\s*\(\s*{/g;

  for (const sourceFile of sourceFiles) {
    if (sourceFile.path.endsWith('.spec.ts') || sourceFile.path.endsWith('.test.ts')) {
      continue;
    }

    for (const match of sourceFile.content.matchAll(queryPattern)) {
      const delegate = match[1];
      const operation = match[2];
      if (!siteOwnedDelegates.has(delegate) || !scopedPrismaOperations.has(operation)) {
        continue;
      }

      const openingBraceIndex = (match.index ?? 0) + match[0].lastIndexOf('{');
      const callBody = findCallBody(sourceFile.content, openingBraceIndex);
      const hasSiteScope =
        /\b(?:site_id|from_site_id|to_site_id)\s*:/.test(callBody) ||
        /\b(?:authorizedSiteIds|listAuthorizedSiteIds|getSiteId)\b/.test(
          callBody,
        ) ||
        /\b(?:siteContext|site_context)\.(?:getSiteId|listAuthorizedSiteIds)\b/.test(
          sourceFile.content,
        );

      if (!hasSiteScope) {
        throw new Error(
          `[Lint Error] ${sourceFile.path}:${lineNumber(sourceFile.content, match.index ?? 0)} ` +
            `${delegate}.${operation} must include an active site or authorized-site scope.`,
        );
      }
    }
  }
}

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

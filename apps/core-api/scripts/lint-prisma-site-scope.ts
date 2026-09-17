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

function findNamedObject(content: string, key: string): string | undefined {
  const match = new RegExp(`\\b${key}\\s*:\\s*{`).exec(content);
  if (!match) return undefined;
  const openingBraceIndex = match.index + match[0].lastIndexOf('{');
  return findCallBody(content, openingBraceIndex);
}

function findVariableObject(
  content: string,
  variableName: string,
): string | undefined {
  const declaration = new RegExp(
    `\\b(?:const|let|var)\\s+${variableName}(?:\\s*:[^=]+)?\\s*=\\s*{`,
  ).exec(content);
  if (!declaration) return undefined;
  const openingBraceIndex = declaration.index + declaration[0].lastIndexOf('{');
  return findCallBody(content, openingBraceIndex);
}

function hasScopedWhere(queryBody: string, sourceContent = queryBody): boolean {
  const scopedHelper =
    /(?:\.\.\.)?(?:this\.)?([A-Za-z_$][\w$]*Where)\s*\(/.exec(queryBody)?.[1];
  if (
    scopedHelper &&
    new RegExp(
      `${scopedHelper}[\\s\\S]{0,1200}\\b(?:site_id|from_site_id|to_site_id)\\b`,
    ).test(sourceContent)
  ) {
    return true;
  }

  const whereObject = findNamedObject(queryBody, 'where');
  if (whereObject) {
    return (
      /\b(?:site_id|from_site_id|to_site_id)\s*:/.test(whereObject) ||
      /\b(?:authorizedSiteIds|siteIds|activeSiteId)\b/.test(whereObject)
    );
  }

  const whereVariable =
    /\bwhere\s*(?::\s*)?([A-Za-z_$][\w$]*)?\s*[,}]/.exec(queryBody)?.[1] ??
    (/\bwhere\s*[,}]/.test(queryBody) ? 'where' : undefined);
  if (whereVariable) {
    const variableBody = findVariableObject(sourceContent, whereVariable);
    if (variableBody) {
      return (
        /\b(?:site_id|from_site_id|to_site_id)\s*:/.test(variableBody) ||
        /\b(?:authorizedSiteIds|siteIds|activeSiteId)\b/.test(variableBody)
      );
    }
  }

  const whereBuilder = /\bwhere\s*:\s*(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/.exec(
    queryBody,
  )?.[1];
  if (
    whereBuilder &&
    new RegExp(
      `${whereBuilder}[\\s\\S]{0,1200}\\b(?:site_id|from_site_id|to_site_id)\\b`,
    ).test(sourceContent)
  ) {
    return true;
  }

  return /\bwhere\s*:\s*\w*(?:site|authorized)\w*\b/.test(queryBody);
}

const siteOwnedRelations = [
  'storage_locations',
  'inventory_stock',
  'inventory_transactions',
  'stock_transfers',
  'purchase_orders',
  'vehicle_purchases',
  'vehicle_sales',
  'sales_orders',
  'bays',
  'workshop_opening_hours',
  'workshop_holidays',
  'workshop_orders',
] as const;

export function lintPrismaSiteScopeQueries(
  sourceFiles: readonly SourceFile[],
): void {
  const queryPattern =
    /(?:this\.)?(?:prisma|tx|db|input\.db)\.(\w+)\.(findMany|findFirst|findUnique|count|aggregate|groupBy)\s*\(\s*{/g;

  for (const sourceFile of sourceFiles) {
    if (
      sourceFile.path.endsWith('.spec.ts') ||
      sourceFile.path.endsWith('.test.ts')
    ) {
      continue;
    }

    for (const match of sourceFile.content.matchAll(queryPattern)) {
      const delegate = match[1];
      const operation = match[2];
      if (!scopedPrismaOperations.has(operation)) {
        continue;
      }

      const openingBraceIndex = (match.index ?? 0) + match[0].lastIndexOf('{');
      const callBody = findCallBody(sourceFile.content, openingBraceIndex);
      const hasSiteOwnedDelegate = siteOwnedDelegates.has(delegate);
      const hasSiteOwnedRelation = siteOwnedRelations.some((relation) =>
        new RegExp(`\\b${relation}\\s*:`).test(callBody),
      );
      if (!hasSiteOwnedDelegate && !hasSiteOwnedRelation) continue;

      const hasSiteScope = hasScopedWhere(callBody, sourceFile.content);

      if (hasSiteOwnedDelegate && !hasSiteScope) {
        throw new Error(
          `[Lint Error] ${sourceFile.path}:${lineNumber(sourceFile.content, match.index ?? 0)} ` +
            `${delegate}.${operation} must include an active site or authorized-site scope.`,
        );
      }

      for (const relation of siteOwnedRelations) {
        const relationMatch = new RegExp(`\\b${relation}\\s*:`).exec(callBody);
        const relationPrefix = relationMatch
          ? callBody.slice(0, relationMatch.index)
          : '';
        const isCountProjection =
          relationPrefix.lastIndexOf('_count') >
          relationPrefix.lastIndexOf('}');
        const relationBody = findNamedObject(callBody, relation);
        if (
          relationMatch &&
          !isCountProjection &&
          (!relationBody || !hasScopedWhere(relationBody, sourceFile.content))
        ) {
          throw new Error(
            `[Lint Error] ${sourceFile.path}:${lineNumber(sourceFile.content, match.index ?? 0)} ` +
              `${delegate}.${operation} includes site-owned relation '${relation}' without site scope.`,
          );
        }
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
      (fieldName) => !new RegExp(`^\\s+${fieldName}\\s+`, 'm').test(model.body),
    );

    if (missingFields.length > 0) {
      throw new Error(
        `[Lint Error] Site-owned model '${model.name}' is missing ${missingFields.join(', ')}.`,
      );
    }
  }
}

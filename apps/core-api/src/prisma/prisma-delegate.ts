type PrismaDelegate = {
  findFirst?: (findArgs: {
    where: Record<string, unknown>;
    select?: { id: boolean } | Record<string, unknown>;
  }) => Promise<any>;
  findMany?: (findArgs: {
    where?: Record<string, unknown>;
    select?: Record<string, unknown>;
  } | Record<string, unknown>) => Promise<any[]>;
};

export function toPrismaDelegateKey(modelName: string): string {
  if (!modelName) {
    return modelName;
  }

  return modelName.charAt(0).toLowerCase() + modelName.slice(1);
}

function isPrismaDelegateCandidate(value: unknown): value is PrismaDelegate {
  return Boolean(
    value &&
      (typeof value === 'object' || typeof value === 'function') &&
      (typeof (value as PrismaDelegate).findFirst === 'function' ||
        typeof (value as PrismaDelegate).findMany === 'function'),
  );
}

function findNestedDelegateCandidate(value: unknown): PrismaDelegate | undefined {
  if (
    !value ||
    (typeof value !== 'object' && typeof value !== 'function')
  ) {
    return undefined;
  }

  if (isPrismaDelegateCandidate(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = findNestedDelegateCandidate(item);
      if (candidate) {
        return candidate;
      }
    }

    return undefined;
  }

  for (const nested of Object.values(value as Record<string, unknown>)) {
    const candidate = findNestedDelegateCandidate(nested);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

export function resolvePrismaModelDelegate(
  context: Record<string, unknown>,
  modelName: string,
): PrismaDelegate | undefined {
  const delegateKey = toPrismaDelegateKey(modelName);
  const directDelegate = context[delegateKey] ?? context[modelName];

  if (isPrismaDelegateCandidate(directDelegate)) {
    return directDelegate;
  }

  if (typeof context.findFirst === 'function') {
    return context as PrismaDelegate;
  }

  return findNestedDelegateCandidate(context);
}

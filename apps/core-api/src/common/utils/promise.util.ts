/**
 * Executes an array of promises concurrently in chunks to prevent connection pool exhaustion
 * or memory issues when dealing with large datasets (e.g., Prisma bulk updates).
 *
 * @param items The array of items to process
 * @param operation The async operation to perform on each item
 * @param chunkSize The maximum number of concurrent operations (default: 50)
 * @returns A promise that resolves to an array of results from all operations
 */
export async function chunkedPromiseAll<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  chunkSize: number = 50,
): Promise<R[]> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('chunkSize must be a positive integer');
  }

  const results: R[] = [];

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    // Execute the current chunk concurrently
    const chunkResults = await Promise.all(
      chunk.map((item) => operation(item)),
    );
    results.push(...chunkResults);
  }

  return results;
}

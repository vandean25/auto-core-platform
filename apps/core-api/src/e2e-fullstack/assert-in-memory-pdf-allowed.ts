export function assertE2eFullstackInMemoryPdfAllowed(
  nodeEnv: string,
  inMemoryPdfEnabled: boolean,
): void {
  if (inMemoryPdfEnabled && nodeEnv !== 'test') {
    throw new Error(
      'E2E_FULLSTACK_IN_MEMORY_PDF is only allowed when NODE_ENV=test',
    );
  }
}

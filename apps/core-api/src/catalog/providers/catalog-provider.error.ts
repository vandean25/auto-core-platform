export class CatalogProviderError extends Error {
  constructor(message = 'Catalog provider request failed') {
    super(message);
    this.name = 'CatalogProviderError';
  }
}

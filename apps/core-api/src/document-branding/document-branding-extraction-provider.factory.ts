import {
  DisabledDocumentBrandingExtractionProvider,
  type DocumentBrandingExtractionProvider,
} from './document-branding-extraction-provider.js';
import {
  OPENROUTER_DEFAULT_MODEL,
  OpenRouterDocumentBrandingExtractionProvider,
} from './openrouter-document-branding-extraction-provider.js';
import { VertexDocumentBrandingExtractionProvider } from './vertex-document-branding-extraction-provider.js';

export type DocumentBrandExtractionProviderId =
  'disabled' | 'openrouter' | 'vertex';

export function readDocumentBrandExtractionProviderId(
  env: NodeJS.ProcessEnv = process.env,
): DocumentBrandExtractionProviderId {
  const raw = env.DOCUMENT_BRAND_EXTRACTION_PROVIDER?.trim().toLowerCase();
  if (raw === 'openrouter' || raw === 'vertex' || raw === 'disabled') {
    return raw;
  }
  return 'disabled';
}

export function readDocumentBrandExtractionModelId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.DOCUMENT_BRAND_EXTRACTION_MODEL?.trim();
  return configured && configured.length > 0
    ? configured
    : OPENROUTER_DEFAULT_MODEL;
}

export function createDocumentBrandingExtractionProvider(
  env: NodeJS.ProcessEnv = process.env,
): DocumentBrandingExtractionProvider {
  const providerId = readDocumentBrandExtractionProviderId(env);
  switch (providerId) {
    case 'openrouter':
      return new OpenRouterDocumentBrandingExtractionProvider({
        apiKey: env.OPENROUTER_API_KEY,
        modelId: readDocumentBrandExtractionModelId(env),
      });
    case 'vertex':
      return new VertexDocumentBrandingExtractionProvider();
    case 'disabled':
    default:
      return new DisabledDocumentBrandingExtractionProvider();
  }
}

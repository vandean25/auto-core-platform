import registryJson from './public-error-code-registry.generated.json' with { type: 'json' };

export type PublicErrorCodeRegistryEntry = {
  public: boolean;
  params: string[];
};

export type PublicErrorCodeRegistry = {
  version: number;
  codes: Record<string, PublicErrorCodeRegistryEntry>;
};

export const PUBLIC_ERROR_CODE_REGISTRY =
  registryJson as PublicErrorCodeRegistry;

export function isPublicWireErrorCode(code: string): boolean {
  return PUBLIC_ERROR_CODE_REGISTRY.codes[code]?.public === true;
}

export function listPublicWireErrorCodes(): string[] {
  return Object.entries(PUBLIC_ERROR_CODE_REGISTRY.codes)
    .filter(([, entry]) => entry.public)
    .map(([code]) => code)
    .sort();
}

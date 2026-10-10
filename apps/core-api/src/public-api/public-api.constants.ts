/**
 * OpenAPI security scheme name for tenant API keys (ADR-0026). Its bearer format is
 * `acp_live_<keyId>_<secret>`. The name must match the scheme registered in
 * apps/core-api/scripts/generate-openapi.mjs.
 */
export const PUBLIC_API_KEY_SCHEME = 'PublicApiKey';

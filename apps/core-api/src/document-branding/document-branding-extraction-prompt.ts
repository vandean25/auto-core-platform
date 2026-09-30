import { DOCUMENT_BRAND_EXTRACTION_PROMPT_VERSION } from './document-branding-extraction-provider.js';

const PROMPTS: Record<string, string> = {
  'document-branding-v1': `You analyze a normalized first-page letterhead image and return ONLY a JSON object with exactly these keys: confidence, cropRect, theme, warningCodes.

Rules:
- confidence must be "SUFFICIENT" only when colors and layout are clear; otherwise use "LOW".
- cropRect is null or an object { x, y, width, height } with unit-interval coordinates for the logo region. When non-null: x and y are in [0, 1], width and height are in (0, 1], and x + width <= 1 and y + height <= 1.
- theme contains exactly: schemaVersion, presetId, primaryColor, secondaryColor, fontId, headerBand, footerBand, headerText, footerText.
- schemaVersion must be the JSON number 1 (not a string). presetId must be "standard-v1". fontId must be "acp-sans-v1".
- primaryColor and secondaryColor are #RRGGBB hex. primaryColor contrast against white (#FFFFFF) must be at least 4.5:1; darken sampled brand colors until that passes (mid blues such as #3B82F6 fail).
- headerBand and footerBand are one of: none, primary, secondary.
- headerText and footerText are plain decorative text (max 120 chars each). Do not use <, >, \${, {{, or }} in either field. footerText must not contain newlines; headerText allows at most one newline.
- warningCodes is an array containing only: PDF_ADDITIONAL_PAGES_IGNORED, UNSUPPORTED_FONT_IGNORED, UNSUPPORTED_LAYOUT_IGNORED (max 8 entries).
- Do not include any other keys. Do not reference URLs, asset IDs, or external resources.`,
};

export function buildDocumentBrandingExtractionPrompt(
  promptVersion: string,
): string {
  const prompt = PROMPTS[promptVersion];
  if (!prompt) {
    throw new Error(
      `Unsupported document branding prompt version: ${promptVersion}`,
    );
  }
  return prompt;
}

export function isSupportedDocumentBrandingPromptVersion(
  promptVersion: string,
): boolean {
  return promptVersion in PROMPTS;
}

export const SUPPORTED_DOCUMENT_BRANDING_PROMPT_VERSION =
  DOCUMENT_BRAND_EXTRACTION_PROMPT_VERSION;

import type { DisplayLanguage } from '@prisma/client';
import { DEFAULT_DISPLAY_LANGUAGE } from './display-language.js';

/**
 * Locale currently emitted by PDF/HTML renderers and customer email templates.
 * TODO(AUT-586): replace with resolved customer document language once render
 * pipelines load and apply per-locale template resources.
 */
export function documentLocaleFrozenForCurrentRenderers(): DisplayLanguage {
  return DEFAULT_DISPLAY_LANGUAGE;
}

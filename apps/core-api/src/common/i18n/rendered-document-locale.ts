import type { DisplayLanguage } from '@prisma/client';
import { DEFAULT_DISPLAY_LANGUAGE } from './display-language.js';

/**
 * Customer email templates (AUT-588) still freeze German until that ticket ships.
 * PDF renderers resolve language from each document snapshot or customer default.
 */
export function documentLocaleFrozenForCurrentRenderers(): DisplayLanguage {
  return DEFAULT_DISPLAY_LANGUAGE;
}

import type { DisplayLanguage } from './display-language.js';
import { DEFAULT_DISPLAY_LANGUAGE } from './display-language.js';

/**
 * Legacy PDF snapshots without bundle metadata still render German labels.
 * Customer emails always freeze the locale chosen at render time on the outbox row.
 */
export function documentLocaleFrozenForCurrentRenderers(): DisplayLanguage {
  return DEFAULT_DISPLAY_LANGUAGE;
}

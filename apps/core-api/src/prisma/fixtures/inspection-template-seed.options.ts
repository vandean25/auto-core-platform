import type { DisplayLanguage } from '../../common/i18n/display-language.js';

export type InspectionTemplateSeedOptions = {
  language?: DisplayLanguage;
  /**
   * When true, upsert updates title/labels from seed master copy. Default false so
   * re-seeds do not overwrite tenant-edited checklist text.
   */
  refreshLocalizedCopy?: boolean;
};

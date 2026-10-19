import { ImportMappingProfileService } from './import-mapping-profile.service.js';
import { ImportRetentionService } from './import-retention.service.js';
import { ImportService } from './import.service.js';

export const importModuleProviders = [
  ImportService,
  ImportMappingProfileService,
  ImportRetentionService,
];

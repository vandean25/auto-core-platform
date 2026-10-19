import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../../site/site.authorization.js';
import {
  validateMigrationBundle,
  type MigrationManifest,
} from '../migration-manifest.validator.js';

@Injectable()
export class CanonicalMigrationBundleService {
  constructor(private readonly tenantContext: TenantContextService) {}

  validateBundle(params: {
    manifest: MigrationManifest;
    files: Record<string, Buffer>;
    assets?: Record<string, Buffer>;
  }) {
    assertTenantAdmin(this.tenantContext);
    const issues = validateMigrationBundle({
      manifest: params.manifest,
      files: params.files,
      assets: params.assets,
    });
    if (issues.length > 0) {
      return { valid: false, issues };
    }
    return { valid: true, issues: [] as const };
  }
}

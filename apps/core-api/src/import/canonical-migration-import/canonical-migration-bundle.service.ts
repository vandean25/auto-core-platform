import { BadRequestException, Injectable } from '@nestjs/common';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../../site/site.authorization.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from '../migration-manifest.errors.js';
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
  }) {
    assertTenantAdmin(this.tenantContext);
    const issues = validateMigrationBundle({
      manifest: params.manifest,
      files: params.files,
    });
    if (issues.length > 0) {
      throw new BadRequestException({
        code:
          issues[0]?.code ??
          MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_MANIFEST_SCHEMA_INVALID,
        message: issues[0]?.message ?? 'Migration bundle validation failed',
        issues,
      });
    }
    return { valid: true, issues: [] as const };
  }
}

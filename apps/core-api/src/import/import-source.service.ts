import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import {
  normalizeImportSourceKey,
  validateImportSourceKey,
} from './import-source.validation.js';
import type { ImportSourceResponseDto } from './dto/import-source-response.dto.js';
import type { CreateImportSourceDto } from './dto/create-import-source.dto.js';
import type { UpdateImportSourceDto } from './dto/update-import-source.dto.js';

const DEFAULT_SOURCE_MAX_ATTEMPTS = 10;

function isUniqueConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

// The partial unique index rejects a second default; re-running the clear-and-set
// transaction after that conflict converges on the last request's choice.
// A P2002 carries no constraint name under the driver adapter, so the caller
// resolves a duplicate key with a lookup instead of inspecting the error.
async function withDefaultSourceRetry<T>(
  operation: () => Promise<T>,
  duplicateKeyExists: () => Promise<boolean> = () => Promise.resolve(false),
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        !isUniqueConflict(error) ||
        attempt >= DEFAULT_SOURCE_MAX_ATTEMPTS ||
        (await duplicateKeyExists())
      ) {
        throw error;
      }
    }
  }
}

@Injectable()
export class ImportSourceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listSources(): Promise<ImportSourceResponseDto[]> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const rows = await this.prisma.importSource.findMany({
      where: { tenant_id: tenantId },
      orderBy: [{ is_default: 'desc' }, { key: 'asc' }],
    });

    return rows.map((row) => this.toDto(row));
  }

  async createSource(
    dto: CreateImportSourceDto,
  ): Promise<ImportSourceResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const normalizedKey = normalizeImportSourceKey(dto.key);
    const validation = validateImportSourceKey(normalizedKey);
    if (!validation.valid) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.INVALID_SOURCE_KEY,
        message: validation.error,
      });
    }

    const label = dto.label?.trim();
    if (!label) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.INVALID_SOURCE_KEY,
        message: 'Import source label is required',
      });
    }

    const isDefault = dto.is_default ?? false;
    const duplicateKeyExists = async () =>
      (await this.prisma.importSource.count({
        where: { tenant_id: tenantId, key: normalizedKey },
      })) > 0;

    try {
      const created = await withDefaultSourceRetry(
        () =>
          this.prisma.$transaction(async (tx) => {
            if (isDefault) {
              await tx.importSource.updateMany({
                where: { tenant_id: tenantId, is_default: true },
                data: { is_default: false },
              });
            }

            const hasAnySource =
              (await tx.importSource.count({
                where: { tenant_id: tenantId },
              })) > 0;

            return tx.importSource.create({
              data: {
                tenant_id: tenantId,
                key: normalizedKey,
                label,
                is_default: isDefault || !hasAnySource,
              },
            });
          }),
        duplicateKeyExists,
      );

      return this.toDto(created);
    } catch (error) {
      if (isUniqueConflict(error) && (await duplicateKeyExists())) {
        throw new ConflictException({
          code: IMPORT_ERROR_CODES.SOURCE_ALREADY_EXISTS,
          message: `Import source with key '${normalizedKey}' already exists`,
        });
      }
      throw error;
    }
  }

  async updateSource(
    sourceId: string,
    dto: UpdateImportSourceDto,
  ): Promise<ImportSourceResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const existing = await this.prisma.importSource.findFirst({
      where: { id: sourceId, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: IMPORT_ERROR_CODES.SOURCE_NOT_FOUND,
        message: 'Import source not found',
      });
    }

    const updated = await withDefaultSourceRetry(() =>
      this.prisma.$transaction(async (tx) => {
        if (dto.is_default === true) {
          await tx.importSource.updateMany({
            where: { tenant_id: tenantId, is_default: true },
            data: { is_default: false },
          });
        }

        return tx.importSource.update({
          where: { id: sourceId, tenant_id: tenantId },
          data: {
            ...(dto.label !== undefined ? { label: dto.label.trim() } : {}),
            ...(dto.is_default !== undefined
              ? { is_default: dto.is_default }
              : {}),
          },
        });
      }),
    );

    return this.toDto(updated);
  }

  async deleteSource(sourceId: string): Promise<void> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const existing = await this.prisma.importSource.findFirst({
      where: { id: sourceId, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: IMPORT_ERROR_CODES.SOURCE_NOT_FOUND,
        message: 'Import source not found',
      });
    }

    await this.prisma.importSource.delete({
      where: { id: sourceId, tenant_id: tenantId },
    });
  }

  async assertSourceExists(sourceSystem: string): Promise<void> {
    const tenantId = await this.tenantContext.getTenantId();
    const trimmed = sourceSystem.trim();
    if (!trimmed) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.UNKNOWN_SOURCE,
        message: 'sourceSystem is required',
      });
    }

    const found = await this.prisma.importSource.findFirst({
      where: { tenant_id: tenantId, key: trimmed },
    });
    if (!found) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.UNKNOWN_SOURCE,
        message: `Unknown import source: '${trimmed}'`,
      });
    }
  }

  private toDto(row: {
    id: string;
    key: string;
    label: string;
    is_default: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ImportSourceResponseDto {
    return {
      id: row.id,
      key: row.key,
      label: row.label,
      is_default: row.is_default,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}

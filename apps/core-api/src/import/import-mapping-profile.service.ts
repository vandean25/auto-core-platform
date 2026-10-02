import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ImportEntityType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { ImportMappingProfileResponseDto } from './dto/import-mapping-profile-response.dto.js';
import type { CreateImportMappingProfileDto } from './dto/create-import-mapping-profile.dto.js';

@Injectable()
export class ImportMappingProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listProfiles(params: {
    entityType: ImportEntityType;
    sourceSystem: string;
  }): Promise<ImportMappingProfileResponseDto[]> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const sourceSystem = params.sourceSystem.trim();
    if (!sourceSystem) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.INVALID_MAPPING,
        message: 'source_system is required',
      });
    }

    const rows = await this.prisma.importMappingProfile.findMany({
      where: {
        tenant_id: tenantId,
        entity_type: params.entityType,
        source_system: sourceSystem,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((row) => this.toDto(row));
  }

  async createProfile(
    body: CreateImportMappingProfileDto,
  ): Promise<ImportMappingProfileResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const name = body.name?.trim();
    const sourceSystem = body.source_system?.trim();
    if (!name) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.INVALID_MAPPING,
        message: 'Profile name is required',
      });
    }
    if (!sourceSystem) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.INVALID_MAPPING,
        message: 'source_system is required',
      });
    }
    const mapping = this.parseStringMapping(body.mapping);

    try {
      const created = await this.prisma.importMappingProfile.create({
        data: {
          tenant_id: tenantId,
          entity_type: body.entity_type,
          source_system: sourceSystem,
          name,
          mapping_json: mapping,
        },
      });
      return this.toDto(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: IMPORT_ERROR_CODES.MAPPING_PROFILE_EXISTS,
          message: 'A mapping profile with this name already exists',
        });
      }
      throw error;
    }
  }

  private parseStringMapping(
    mapping: Record<string, string>,
  ): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (const [key, value] of Object.entries(mapping)) {
      if (typeof value !== 'string') {
        throw new BadRequestException({
          code: IMPORT_ERROR_CODES.INVALID_MAPPING,
          message: `mapping.${key} must be a string`,
        });
      }
      parsed[key] = value;
    }
    return parsed;
  }

  private toDto(row: {
    id: string;
    entity_type: ImportEntityType;
    source_system: string;
    name: string;
    mapping_json: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }): ImportMappingProfileResponseDto {
    const mapping = this.readStringMappingFromJson(row.mapping_json);
    return {
      id: row.id,
      entity_type: row.entity_type,
      source_system: row.source_system,
      name: row.name,
      mapping,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private readStringMappingFromJson(
    value: Prisma.JsonValue,
  ): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const mapping: Record<string, string> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === 'string') {
        mapping[key] = entry;
      }
    }
    return mapping;
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LegalEntityAccountingProfile } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { assertTenantAdmin } from '../../site/site.authorization.js';
import {
  buildRequiredSourceCategories,
  computeAccountingProfileReadiness,
} from './accounting-profile-readiness.js';
import { toAccountingProfileResponse } from './accounting-profile.mapper.js';
import { UpdateAccountingProfileDto } from './dto/accounting-profile.dto.js';
import type { AccountingMappingRule } from './accounting-profile.types.js';
import {
  type AccountingProfilePatchInput,
  defaultFormatVersionForCountry,
  defaultProfileCodeForCountry,
  validateAccountingProfilePatch,
} from './accounting-profile.validation.js';

function parseStoredMappingRules(value: unknown): AccountingMappingRule[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as AccountingMappingRule[];
}

@Injectable()
export class AccountingProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getAccountingProfile(legalEntityId: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const entity = await this.findLegalEntity(tenantId, legalEntityId);
    const profile = await this.ensureProfile(
      tenantId,
      entity.id,
      entity.country_iso,
    );
    const revenueGroups = await this.loadRevenueGroups(tenantId);

    return toAccountingProfileResponse(
      profile,
      entity.country_iso,
      revenueGroups,
    );
  }

  async updateAccountingProfile(
    legalEntityId: string,
    dto: UpdateAccountingProfileDto,
  ) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const entity = await this.findLegalEntity(tenantId, legalEntityId);
    const existing = await this.ensureProfile(
      tenantId,
      entity.id,
      entity.country_iso,
    );

    const patch = validateAccountingProfilePatch(
      {
        profileCode: dto.profileCode,
        formatVersion: dto.formatVersion,
        chart: dto.chart,
        accountLength: dto.accountLength,
        advisorNumber: dto.advisorNumber,
        clientNumber: dto.clientNumber,
        fiscalYearStartMonth: dto.fiscalYearStartMonth,
        defaultDebtorAccount: dto.defaultDebtorAccount,
        mappingRules: dto.mappingRules,
        isEnabled: dto.isEnabled,
      },
      entity.country_iso,
    );

    const revenueGroups = await this.loadRevenueGroups(tenantId);
    if (patch.isEnabled === true) {
      this.assertProfileReadyForEnablement(
        existing,
        patch,
        entity.country_iso,
        revenueGroups,
      );
    }

    const updateData: Prisma.LegalEntityAccountingProfileUpdateManyMutationInput =
      {
        version: { increment: 1 },
      };

    if (patch.profileCode !== undefined) {
      updateData.profile_code = patch.profileCode;
    }
    if (patch.formatVersion !== undefined) {
      updateData.format_version = patch.formatVersion;
    }
    if (patch.chart !== undefined) {
      updateData.chart = patch.chart;
    }
    if (patch.accountLength !== undefined) {
      updateData.account_length = patch.accountLength;
    }
    if (patch.advisorNumber !== undefined) {
      updateData.advisor_number = patch.advisorNumber;
    }
    if (patch.clientNumber !== undefined) {
      updateData.client_number = patch.clientNumber;
    }
    if (patch.fiscalYearStartMonth !== undefined) {
      updateData.fiscal_year_start_month = patch.fiscalYearStartMonth;
    }
    if (patch.defaultDebtorAccount !== undefined) {
      updateData.default_debtor_account = patch.defaultDebtorAccount;
    }
    if (patch.mappingRules !== undefined) {
      updateData.mapping_rules = patch.mappingRules;
    }
    if (patch.isEnabled !== undefined) {
      updateData.is_enabled = patch.isEnabled;
    }

    const updateResult =
      await this.prisma.legalEntityAccountingProfile.updateMany({
        where: {
          id: existing.id,
          tenant_id: tenantId,
          version: dto.expectedVersion,
        },
        data: updateData,
      });

    if (updateResult.count !== 1) {
      throw new ConflictException(
        `Version conflict: expected ${dto.expectedVersion}, current ${existing.version}.`,
      );
    }

    const updated =
      await this.prisma.legalEntityAccountingProfile.findFirstOrThrow({
        where: { id: existing.id, tenant_id: tenantId },
      });

    return toAccountingProfileResponse(
      updated,
      entity.country_iso,
      revenueGroups,
    );
  }

  private assertProfileReadyForEnablement(
    existing: LegalEntityAccountingProfile,
    patch: AccountingProfilePatchInput,
    countryIso: 'AT' | 'DE',
    revenueGroups: {
      id: number;
      name: string;
      tax_rate: { toString(): string };
      account_number: string;
    }[],
  ): void {
    const mergedMappingRules =
      patch.mappingRules ?? parseStoredMappingRules(existing.mapping_rules);
    const readiness = computeAccountingProfileReadiness({
      countryIso,
      advisorNumber:
        patch.advisorNumber !== undefined
          ? patch.advisorNumber
          : existing.advisor_number,
      clientNumber:
        patch.clientNumber !== undefined
          ? patch.clientNumber
          : existing.client_number,
      accountLength:
        patch.accountLength !== undefined
          ? patch.accountLength
          : existing.account_length,
      defaultDebtorAccount:
        patch.defaultDebtorAccount !== undefined
          ? patch.defaultDebtorAccount
          : existing.default_debtor_account,
      mappingRules: mergedMappingRules,
      requiredSourceCategories: buildRequiredSourceCategories(revenueGroups),
    });

    if (!readiness.isReady) {
      throw new BadRequestException(
        'Accounting profile mapping must be complete before enabling DATEV export',
      );
    }
  }

  private async findLegalEntity(tenantId: string, legalEntityId: string) {
    const entity = await this.prisma.legalEntity.findFirst({
      where: { id: legalEntityId, tenant_id: tenantId },
      select: { id: true, country_iso: true },
    });
    if (!entity) {
      throw new NotFoundException('Legal entity not found');
    }
    return entity;
  }

  private async ensureProfile(
    tenantId: string,
    legalEntityId: string,
    countryIso: 'AT' | 'DE',
  ) {
    const existing = await this.prisma.legalEntityAccountingProfile.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.legalEntityAccountingProfile.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        version: 1,
        is_enabled: false,
        profile_code: defaultProfileCodeForCountry(countryIso),
        format_version: defaultFormatVersionForCountry(countryIso),
        mapping_rules: [],
      },
    });
  }

  private async loadRevenueGroups(tenantId: string) {
    return this.prisma.revenueGroup.findMany({
      where: { tenant_id: tenantId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        tax_rate: true,
        account_number: true,
      },
    });
  }
}

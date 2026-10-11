import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { z } from 'zod';
import { SiteContextService } from '../common/services/site-context.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertActiveMemberWithSiteAccess } from '../site/site.authorization.js';
import { calendarYearInVienna } from '../workshop/workshop-estimate-number.helpers.js';
import { isMcpSupervisorRole } from './mcp.authorization.js';
import { MCP_DEFAULT_PAGE_SIZE } from './mcp.constants.js';
import { decodeMcpCursor, encodeMcpCursor } from './mcp-output.util.js';
import {
  toMcpAccountingProfileStatus,
  toMcpLegalEntity,
  toMcpNumberRanges,
  toMcpSiteRow,
  toMcpTaxRates,
  toMcpTenantSettings,
} from './mcp-settings-read.mapper.js';
import type {
  getLegalEntityInputSchema,
  listSitesInputSchema,
} from './mcp-tool-schemas.js';

type ListSitesInput = z.infer<typeof listSitesInputSchema>;
type GetLegalEntityInput = z.infer<typeof getLegalEntityInputSchema>;

const SITE_LIST_SELECT = {
  id: true,
  name: true,
  is_active: true,
  address_street: true,
  address_zip: true,
  address_city: true,
  address_country: true,
} as const;

/**
 * `representatives` is selected only because the seller readiness type names
 * it. It is never returned, since it holds personal names.
 */
const LEGAL_ENTITY_SELECT = {
  id: true,
  name: true,
  country_iso: true,
  is_active: true,
  address_street: true,
  address_line2: true,
  address_zip: true,
  address_city: true,
  tax_number: true,
  vat_id: true,
  iban: true,
  bic: true,
  bank_name: true,
  email: true,
  phone: true,
  registration_number: true,
  registration_court: true,
  representatives: true,
  payment_terms_days: true,
  payment_terms_text: true,
} as const;

const ACCOUNTING_PROFILE_SELECT = {
  is_enabled: true,
  profile_code: true,
  advisor_number: true,
  client_number: true,
  account_length: true,
  default_debtor_account: true,
  mapping_rules: true,
} as const;

const REVENUE_GROUP_SELECT = {
  id: true,
  name: true,
  tax_rate: true,
  account_number: true,
  is_default: true,
} as const;

const FINANCE_COUNTER_SELECT = {
  sales_order_prefix: true,
  next_sales_order_number: true,
  workshop_order_prefix: true,
  next_workshop_order_number: true,
  vehicle_purchase_prefix: true,
  next_vehicle_purchase_number: true,
  vehicle_sale_prefix: true,
  next_vehicle_sale_number: true,
  stock_transfer_prefix: true,
  next_stock_transfer_number: true,
} as const;

const VOICE_SELECT = {
  target_language_code: true,
  google_project_id: true,
  google_service_account_encrypted: true,
} as const;

const CATALOG_SELECT = {
  default_identity_adapter_id: true,
  default_parts_aftermarket_adapter_id: true,
  default_labor_aftermarket_adapter_id: true,
  aw_minutes: true,
  identity_credentials_secret_ref: true,
  parts_aftermarket_credentials_secret_ref: true,
  labor_aftermarket_credentials_secret_ref: true,
} as const;

const TYRE_STORAGE_SELECT = {
  summer_swap_month: true,
  summer_swap_day: true,
  winter_swap_month: true,
  winter_swap_day: true,
  due_for_swap_days: true,
} as const;

const BRANDING_SELECT = {
  legal_entity_id: true,
  active_revision: true,
  confirmed_at: true,
  active_logo_asset_id: true,
  active_theme: true,
  draft_theme: true,
} as const;

function decodeOffsetOrThrow(cursor: string): number {
  const offset = decodeMcpCursor(cursor);
  if (offset === null) {
    throw new BadRequestException('cursor is invalid');
  }
  return offset;
}

/**
 * Read-only settings tools. Every query is scoped by the tenant from the
 * session. Calls that do not name a legal entity use the active site's, as the
 * invoice reads do. The REST services behind these settings are ADMIN-only, so
 * this service queries the tables directly and never calls them. It writes
 * nothing.
 */
@Injectable()
export class McpSettingsReadService {
  constructor(
    private readonly decisionLiveApply: DecisionLiveApplyService,
    private readonly prisma: PrismaService,
    private readonly siteContext: SiteContextService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async getTenantSettings() {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.findSiteId();
    const [decisionApplyMode, voice, catalog, tyre, site, legalEntities] =
      await Promise.all([
        this.decisionLiveApply.resolveEffectiveMode(tenantId),
        this.prisma.voiceTranslationSettings.findFirst({
          where: { tenant_id: tenantId },
          select: VOICE_SELECT,
        }),
        this.prisma.catalogProviderSettings.findFirst({
          where: { tenant_id: tenantId },
          select: CATALOG_SELECT,
        }),
        this.prisma.tyreStorageSettings.findFirst({
          where: { tenant_id: tenantId },
          select: TYRE_STORAGE_SELECT,
        }),
        siteId
          ? this.prisma.site.findFirst({
              where: { id: siteId, tenant_id: tenantId },
              select: { timezone: true },
            })
          : Promise.resolve(null),
        this.prisma.legalEntity.findMany({
          where: { tenant_id: tenantId, is_active: true },
          orderBy: { name: 'asc' },
          select: { id: true, name: true },
        }),
      ]);

    const brandingRows = await this.prisma.documentBrandProfile.findMany({
      where: {
        tenant_id: tenantId,
        legal_entity_id: { in: legalEntities.map((entity) => entity.id) },
      },
      select: BRANDING_SELECT,
    });
    const brandingByEntity = new Map(
      brandingRows.map((row) => [row.legal_entity_id, row]),
    );

    return toMcpTenantSettings({
      decisionApplyMode,
      activeSiteTimezone: site?.timezone ?? null,
      voice,
      catalog,
      tyre,
      legalEntities: legalEntities.map((entity) => ({
        entity,
        branding: brandingByEntity.get(entity.id) ?? null,
      })),
    });
  }

  /**
   * Names-only directory rule, as the REST listing applies it: any member
   * with an active site membership sees the active sites. OWNER and ADMIN also
   * see inactive sites, without needing a membership (ruling 53).
   */
  async listSites(input: ListSitesInput) {
    const tenantId = await this.tenantContext.getTenantId();
    const includeInactive = isMcpSupervisorRole(this.currentRole());
    if (!includeInactive) {
      await assertActiveMemberWithSiteAccess(
        this.prisma,
        this.tenantContext,
        tenantId,
      );
    }

    const pageSize = input.pageSize ?? MCP_DEFAULT_PAGE_SIZE;
    const offset =
      input.cursor === undefined ? 0 : decodeOffsetOrThrow(input.cursor);
    const rows = await this.prisma.site.findMany({
      where: {
        tenant_id: tenantId,
        ...(includeInactive ? {} : { is_active: true }),
      },
      orderBy: [{ code: 'asc' }, { id: 'asc' }],
      skip: offset,
      take: pageSize + 1,
      select: SITE_LIST_SELECT,
    });

    return {
      data: rows.slice(0, pageSize).map(toMcpSiteRow),
      meta: {
        page_size: pageSize,
        next_cursor:
          rows.length > pageSize ? encodeMcpCursor(offset + pageSize) : null,
      },
    };
  }

  async getLegalEntity(input: GetLegalEntityInput) {
    const tenantId = await this.tenantContext.getTenantId();
    const legalEntityId =
      input.legal_entity_id ?? (await this.activeSiteLegalEntityId(tenantId));
    const entity = await this.prisma.legalEntity.findFirst({
      where: { id: legalEntityId, tenant_id: tenantId },
      select: LEGAL_ENTITY_SELECT,
    });
    if (!entity) {
      throw new NotFoundException(
        `Legal entity with ID ${legalEntityId} not found`,
      );
    }

    const now = new Date();
    const calendarYear = now.getFullYear();
    const estimateYear = calendarYearInVienna(now);
    const [
      profile,
      revenueGroups,
      invoice,
      creditNote,
      workshopEstimate,
      finance,
    ] = await Promise.all([
      this.prisma.legalEntityAccountingProfile.findFirst({
        where: { tenant_id: tenantId, legal_entity_id: entity.id },
        select: ACCOUNTING_PROFILE_SELECT,
      }),
      this.prisma.revenueGroup.findMany({
        where: { tenant_id: tenantId },
        orderBy: { name: 'asc' },
        select: REVENUE_GROUP_SELECT,
      }),
      // findFirst, not findUnique: the tenant isolation extension rejects findUnique on tenant models.
      this.prisma.invoiceSequence.findFirst({
        where: { tenant_id: tenantId, year: calendarYear },
        select: { current: true },
      }),
      this.prisma.creditNoteSequence.findFirst({
        where: { tenant_id: tenantId, year: calendarYear },
        select: { current: true },
      }),
      this.prisma.workshopEstimateSequence.findFirst({
        where: { tenant_id: tenantId, year: estimateYear },
        select: { current: true },
      }),
      this.prisma.financeSettings.findFirst({
        where: { tenant_id: tenantId },
        select: FINANCE_COUNTER_SELECT,
      }),
    ]);

    return toMcpLegalEntity(entity, {
      accountingProfile: toMcpAccountingProfileStatus({
        countryIso: entity.country_iso,
        profile,
        revenueGroups,
      }),
      taxRates: toMcpTaxRates(revenueGroups),
      numberRanges: toMcpNumberRanges({
        calendarYear,
        estimateYear,
        invoice,
        creditNote,
        workshopEstimate,
        finance,
      }),
    });
  }

  private async activeSiteLegalEntityId(tenantId: string): Promise<string> {
    const siteId = await this.siteContext.getSiteId();
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenant_id: tenantId },
      select: { legal_entity_id: true },
    });
    if (!site) {
      throw new NotFoundException('Active site not found');
    }
    return site.legal_entity_id;
  }

  private currentRole(): string | undefined {
    const user = this.tenantContext.getAuthenticatedUser();
    return user && 'role' in user ? user.role : undefined;
  }
}

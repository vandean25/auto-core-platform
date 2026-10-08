import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MarginRoundingStrategy, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { assertTenantAdmin } from '../site/site.authorization.js';
import type { CreateMarginRuleDto } from './dto/create-margin-rule.dto.js';
import type { UpdateMarginRuleDto } from './dto/update-margin-rule.dto.js';
import {
  type MarginRuleResponseDto,
  type PriceJumpThresholdResponseDto,
  type UpdatePriceJumpThresholdDto,
} from './dto/margin-rule-response.dto.js';

interface MarginRuleWithRelations {
  id: string;
  tenant_id: string;
  name: string;
  priority: number;
  brand_id: number | null;
  brand?: { id: number; name: string } | null;
  revenue_group_id: number | null;
  revenue_group?: { id: number; name: string } | null;
  cost_min: Prisma.Decimal | number | null;
  cost_max: Prisma.Decimal | number | null;
  markup_percent: Prisma.Decimal | number | null;
  use_supplier_rrp: boolean;
  rounding: MarginRoundingStrategy;
  is_active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class MarginRuleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findAll(): Promise<MarginRuleResponseDto[]> {
    const tenantId = await this.tenantContext.getTenantId();
    const rules = await this.prisma.marginRule.findMany({
      where: { tenant_id: tenantId },
      orderBy: { priority: 'asc' },
      include: {
        brand: { select: { id: true, name: true } },
        revenue_group: { select: { id: true, name: true } },
      },
    });

    return rules.map((rule) => this.toResponseDto(rule));
  }

  async create(dto: CreateMarginRuleDto): Promise<MarginRuleResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    if (
      dto.cost_min != null &&
      dto.cost_max != null &&
      dto.cost_min > dto.cost_max
    ) {
      throw new BadRequestException('cost_min cannot be greater than cost_max');
    }

    if (dto.brand_id != null) {
      const brand = await this.prisma.brand.findFirst({
        where: { id: dto.brand_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!brand) {
        throw new BadRequestException(
          `Brand with ID ${dto.brand_id} not found or belongs to another tenant`,
        );
      }
    }

    if (dto.revenue_group_id != null) {
      const revenueGroup = await this.prisma.revenueGroup.findFirst({
        where: { id: dto.revenue_group_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!revenueGroup) {
        throw new BadRequestException(
          `Revenue group with ID ${dto.revenue_group_id} not found or belongs to another tenant`,
        );
      }
    }

    const created = await this.prisma.marginRule.create({
      data: {
        tenant_id: tenantId,
        name: dto.name,
        priority: dto.priority ?? 0,
        brand_id: dto.brand_id ?? null,
        revenue_group_id: dto.revenue_group_id ?? null,
        cost_min:
          dto.cost_min != null ? new Prisma.Decimal(dto.cost_min) : null,
        cost_max:
          dto.cost_max != null ? new Prisma.Decimal(dto.cost_max) : null,
        markup_percent:
          dto.markup_percent != null
            ? new Prisma.Decimal(dto.markup_percent)
            : null,
        use_supplier_rrp: dto.use_supplier_rrp ?? false,
        rounding: dto.rounding ?? MarginRoundingStrategy.NONE,
        is_active: dto.is_active ?? true,
      },
      include: {
        brand: { select: { id: true, name: true } },
        revenue_group: { select: { id: true, name: true } },
      },
    });

    return this.toResponseDto(created);
  }

  async update(
    id: string,
    dto: UpdateMarginRuleDto,
  ): Promise<MarginRuleResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const existing = await this.prisma.marginRule.findFirst({
      where: { id, tenant_id: tenantId },
    });

    if (!existing) {
      throw new NotFoundException(`Margin rule with ID ${id} not found`);
    }

    if (dto.brand_id !== undefined && dto.brand_id !== null) {
      const brand = await this.prisma.brand.findFirst({
        where: { id: dto.brand_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!brand) {
        throw new BadRequestException(
          `Brand with ID ${dto.brand_id} not found or belongs to another tenant`,
        );
      }
    }

    if (dto.revenue_group_id !== undefined && dto.revenue_group_id !== null) {
      const revenueGroup = await this.prisma.revenueGroup.findFirst({
        where: { id: dto.revenue_group_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!revenueGroup) {
        throw new BadRequestException(
          `Revenue group with ID ${dto.revenue_group_id} not found or belongs to another tenant`,
        );
      }
    }

    const finalCostMin =
      dto.cost_min !== undefined
        ? dto.cost_min
        : existing.cost_min != null
          ? Number(existing.cost_min)
          : null;
    const finalCostMax =
      dto.cost_max !== undefined
        ? dto.cost_max
        : existing.cost_max != null
          ? Number(existing.cost_max)
          : null;

    if (
      finalCostMin != null &&
      finalCostMax != null &&
      finalCostMin > finalCostMax
    ) {
      throw new BadRequestException('cost_min cannot be greater than cost_max');
    }

    const updated = await this.prisma.marginRule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.brand_id !== undefined ? { brand_id: dto.brand_id } : {}),
        ...(dto.revenue_group_id !== undefined
          ? { revenue_group_id: dto.revenue_group_id }
          : {}),
        ...(dto.cost_min !== undefined
          ? {
              cost_min:
                dto.cost_min != null ? new Prisma.Decimal(dto.cost_min) : null,
            }
          : {}),
        ...(dto.cost_max !== undefined
          ? {
              cost_max:
                dto.cost_max != null ? new Prisma.Decimal(dto.cost_max) : null,
            }
          : {}),
        ...(dto.markup_percent !== undefined
          ? {
              markup_percent:
                dto.markup_percent != null
                  ? new Prisma.Decimal(dto.markup_percent)
                  : null,
            }
          : {}),
        ...(dto.use_supplier_rrp !== undefined
          ? { use_supplier_rrp: dto.use_supplier_rrp }
          : {}),
        ...(dto.rounding !== undefined ? { rounding: dto.rounding } : {}),
        ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
      },
      include: {
        brand: { select: { id: true, name: true } },
        revenue_group: { select: { id: true, name: true } },
      },
    });

    return this.toResponseDto(updated);
  }

  async delete(id: string): Promise<{ success: boolean }> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const deleteResult = await this.prisma.marginRule.deleteMany({
      where: { id, tenant_id: tenantId },
    });

    if (deleteResult.count === 0) {
      throw new NotFoundException(`Margin rule with ID ${id} not found`);
    }

    return { success: true };
  }

  async getThreshold(): Promise<PriceJumpThresholdResponseDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const settings = await this.prisma.financeSettings.findUnique({
      where: { tenant_id: tenantId },
      select: { price_jump_threshold_percent: true },
    });

    const val =
      settings?.price_jump_threshold_percent != null
        ? Number(settings.price_jump_threshold_percent)
        : 20;

    return {
      price_jump_threshold_percent: val,
      threshold_percent: val,
    };
  }

  async updateThreshold(
    dto: UpdatePriceJumpThresholdDto,
  ): Promise<PriceJumpThresholdResponseDto> {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const threshold = dto.price_jump_threshold_percent ?? dto.threshold_percent;

    if (
      threshold === undefined ||
      threshold === null ||
      Number.isNaN(threshold) ||
      threshold < 0
    ) {
      throw new BadRequestException(
        'A valid non-negative price jump threshold percentage is required.',
      );
    }

    const currentYear = new Date().getFullYear();
    const settings = await this.prisma.financeSettings.upsert({
      where: { tenant_id: tenantId },
      update: {
        price_jump_threshold_percent: new Prisma.Decimal(threshold),
      },
      create: {
        tenant_id: tenantId,
        fiscal_year_start_month: 1,
        lock_date: null,
        next_invoice_number: 1001,
        invoice_prefix: `RE-${currentYear}-`,
        next_sales_order_number: 1001,
        sales_order_prefix: `SO-${currentYear}-`,
        next_workshop_order_number: 1,
        workshop_order_prefix: `WO-${currentYear}-`,
        price_jump_threshold_percent: new Prisma.Decimal(threshold),
      },
    });

    const val =
      settings.price_jump_threshold_percent != null
        ? Number(settings.price_jump_threshold_percent)
        : Number(threshold);

    return {
      price_jump_threshold_percent: val,
      threshold_percent: val,
    };
  }

  private toResponseDto(rule: MarginRuleWithRelations): MarginRuleResponseDto {
    return {
      id: rule.id,
      tenant_id: rule.tenant_id,
      name: rule.name,
      priority: rule.priority,
      brand_id: rule.brand_id,
      brand: rule.brand ? { id: rule.brand.id, name: rule.brand.name } : null,
      revenue_group_id: rule.revenue_group_id,
      revenue_group: rule.revenue_group
        ? { id: rule.revenue_group.id, name: rule.revenue_group.name }
        : null,
      cost_min: rule.cost_min != null ? Number(rule.cost_min) : null,
      cost_max: rule.cost_max != null ? Number(rule.cost_max) : null,
      markup_percent:
        rule.markup_percent != null ? Number(rule.markup_percent) : null,
      use_supplier_rrp: rule.use_supplier_rrp,
      rounding: rule.rounding,
      is_active: rule.is_active,
      createdAt: rule.createdAt,
      updatedAt: rule.updatedAt,
    };
  }
}

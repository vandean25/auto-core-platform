import { Injectable } from '@nestjs/common';
import type { WarrantyClaimStatus } from '@prisma/client';
import type { z } from 'zod';
import {
  assertConsentLedgerAccess,
  assertCustomerInTenant,
} from '../customer-consent/customer-consent.controller-context.js';
import { CustomerConsentService } from '../customer-consent/customer-consent.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TyreStorageService } from '../tyre-storage/tyre-storage.service.js';
import type { TyreSetResponseDto } from '../tyre-storage/dto/tyre-set.dto.js';
import { VehicleStockQueryService } from '../vehicle-stock/vehicle-stock-query.service.js';
import { WarrantyClaimService } from '../warranty-claim/warranty-claim.service.js';
import { assertWarrantyClaimAccess } from '../warranty-claim/warranty-claim.rules.js';
import { offsetFromCursor, toMcpPageMeta } from './mcp-report-read.mapper.js';
import {
  toMcpGewaehrleistungDueRow,
  toMcpTyreSetRow,
  toMcpWarrantyClaimListRow,
  warrantyClaimKeysetCursorOf,
} from './mcp-compliance-read.mapper.js';
import {
  clampMcpPageSize,
  decodeMcpKeysetCursor,
  encodeMcpCursor,
  encodeMcpKeysetCursor,
} from './mcp-output.util.js';
import type {
  checkContactPermissionInputSchema,
  listGewaehrleistungDueInputSchema,
  listTyreSetsInputSchema,
  listWarrantyClaimsInputSchema,
} from './mcp-tool-schemas.js';

type CheckContactInput = z.infer<typeof checkContactPermissionInputSchema>;
type GewaehrleistungDueInput = z.infer<
  typeof listGewaehrleistungDueInputSchema
>;
type TyreSetsInput = z.infer<typeof listTyreSetsInputSchema>;
type WarrantyClaimsInput = z.infer<typeof listWarrantyClaimsInputSchema>;

const DEFAULT_GEWAEHRLEISTUNG_WITHIN_DAYS = 30;

@Injectable()
export class McpComplianceReadService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly prisma: PrismaService,
    private readonly customerConsent: CustomerConsentService,
    private readonly vehicleStock: VehicleStockQueryService,
    private readonly tyreStorage: TyreStorageService,
    private readonly warrantyClaims: WarrantyClaimService,
  ) {}

  async checkContactPermission(input: CheckContactInput) {
    assertConsentLedgerAccess(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    await assertCustomerInTenant(this.prisma, tenantId, input.customer_id);
    const decision = await this.customerConsent.evaluateCanContactForCustomer(
      input.customer_id,
      input.channel,
      input.purpose,
      input.controller_legal_entity_id,
    );
    return {
      customer_id: input.customer_id,
      purpose: input.purpose,
      channel: input.channel,
      allowed: decision.allowed,
      reason: decision.reason,
    };
  }

  async listGewaehrleistungDue(input: GewaehrleistungDueInput) {
    const withinDays = input.within_days ?? DEFAULT_GEWAEHRLEISTUNG_WITHIN_DAYS;
    const scope = {
      offset: offsetFromCursor(input.cursor),
      pageSize: clampMcpPageSize(input.pageSize),
    };
    const report = await this.vehicleStock.listGewaehrleistungDue({
      endsWithinDays: withinDays,
    });
    const rows = report.data;
    return {
      within_days: withinDays,
      data: rows
        .slice(scope.offset, scope.offset + scope.pageSize)
        .map(toMcpGewaehrleistungDueRow),
      meta: toMcpPageMeta(rows.length, scope),
    };
  }

  async listTyreSets(input: TyreSetsInput) {
    const pageSize = clampMcpPageSize(input.pageSize);
    const offset = offsetFromCursor(input.cursor);

    if (
      !input.due_for_swap &&
      !(input.vehicle_id && !input.customer_id)
    ) {
      const page = Math.floor(offset / pageSize) + 1;
      const listed = await this.tyreStorage.list({
        customerId: input.customer_id,
        status: input.status,
        page,
        pageSize,
      });
      return {
        data: listed.data.map(toMcpTyreSetRow),
        meta: {
          total: listed.meta.total,
          page_size: pageSize,
          next_cursor:
            listed.meta.page < listed.meta.pageCount
              ? encodeMcpCursor(offset + pageSize)
              : null,
        },
      };
    }

    let rows: TyreSetResponseDto[];
    if (input.due_for_swap) {
      const due = await this.tyreStorage.listDueForSwap();
      rows = due.data;
      if (input.customer_id) {
        rows = rows.filter((row) => row.customerId === input.customer_id);
      }
      if (input.vehicle_id) {
        rows = rows.filter((row) => row.vehicleId === input.vehicle_id);
      }
      if (input.status) {
        rows = rows.filter((row) => row.status === input.status);
      }
    } else {
      const vehicleId = input.vehicle_id;
      if (!vehicleId) {
        return { data: [], meta: toMcpPageMeta(0, { offset, pageSize }) };
      }
      const byVehicle = await this.tyreStorage.findByVehicle(vehicleId);
      rows = byVehicle.data;
      if (input.status) {
        rows = rows.filter((row) => row.status === input.status);
      }
    }

    const pageRows = rows.slice(offset, offset + pageSize);
    return {
      data: pageRows.map(toMcpTyreSetRow),
      meta: toMcpPageMeta(rows.length, { offset, pageSize }),
    };
  }

  async listWarrantyClaims(input: WarrantyClaimsInput) {
    assertWarrantyClaimAccess(this.tenantContext);
    const pageSize = clampMcpPageSize(input.pageSize);
    const cursor = input.cursor
      ? decodeMcpKeysetCursor(input.cursor)
      : undefined;
    const statuses: WarrantyClaimStatus[] | undefined = input.status
      ? [input.status]
      : undefined;

    const { rows, total } = await this.warrantyClaims.listAtActiveSite({
      workshopOrderId: input.order_id,
      statuses,
      type: input.type,
      pageSize,
      cursorCreatedAt: cursor ? new Date(cursor.at) : undefined,
      cursorId: cursor?.id,
    });

    const hasMore = rows.length > pageSize;
    const page = rows.slice(0, pageSize).map(toMcpWarrantyClaimListRow);
    const last = page[page.length - 1];
    return {
      data: page,
      meta: {
        total,
        page_size: pageSize,
        next_cursor:
          hasMore && last
            ? encodeMcpKeysetCursor(
                warrantyClaimKeysetCursorOf(last.created_at, last.id),
              )
            : null,
      },
    };
  }
}

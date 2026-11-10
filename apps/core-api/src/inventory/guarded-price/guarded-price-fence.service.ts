import { Injectable, NotFoundException } from '@nestjs/common';
import { InventoryPriceOperationState, Prisma } from '@prisma/client';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  InventoryPriceOperationDto,
  UserFenceInventoryPriceDto,
} from '../dto/inventory-price-operation.dto.js';
import {
  acquireGuardedPriceAdvisoryLock,
  lockGuardedPriceJournalRow,
  setGuardedPriceTxALockTimeout,
} from '../guarded-price-operation-locks.js';
import { assertCanMutateInventoryStock } from '../inventory-access.guards.js';
import {
  assertKeyNotTooFarFuture,
  isKeyInsideAdmissionWindow,
} from './guarded-price-admission.js';
import { GUARDED_PRICE_LEASE_MS } from './guarded-price.constants.js';
import {
  frozenIntentMatchesRow,
  type GuardedPriceIntent,
} from './guarded-price-intent.js';
import {
  GUARDED_PRICE_KIND,
  guardedRequestInvalid,
  idempotencyKeyReused,
  operationUnresolved,
  outcomeUnavailable,
} from './guarded-price.errors.js';
import {
  isInteractiveTransactionExpired,
  isLockTimeoutError,
  isUniqueViolation,
} from './guarded-price.helpers.js';
import { mapInventoryPriceOperation } from './guarded-price-operation.mapper.js';
import { retailMajorToMinorUnits } from './guarded-price.money.js';
import { parseExpectedRevision } from './guarded-price.revision.js';
import { isUuidV7 } from './guarded-price.uuid.js';

@Injectable()
export class GuardedPriceFenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async fenceOperation(
    operationKey: string,
    body: UserFenceInventoryPriceDto,
  ): Promise<InventoryPriceOperationDto> {
    const role = this.tenantContext.getAuthenticatedUser()?.role;
    assertCanMutateInventoryStock(role);
    const principalId = this.requirePrincipalId();
    const tenantId = await this.tenantContext.getTenantId();

    if (!isUuidV7(operationKey)) {
      guardedRequestInvalid('Operation key must be a UUIDv7.');
    }
    assertKeyNotTooFarFuture(operationKey);

    const intent = await this.resolveFenceIntent(tenantId, body);

    try {
      return await this.prisma.$transaction(
        async (tx) => await this.runFenceTx(tx, {
          tenantId,
          principalId,
          operationKey,
          intent,
        }),
        {
          timeout: 10_000,
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        },
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        operationUnresolved(
          'Another guarded operation is still in progress for this item.',
        );
      }
      if (isLockTimeoutError(error) || isInteractiveTransactionExpired(error)) {
        operationUnresolved(
          'Could not acquire the guarded operation lock in time.',
        );
      }
      throw error;
    }
  }

  private async runFenceTx(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      principalId: string;
      operationKey: string;
      intent: GuardedPriceIntent;
    },
  ): Promise<InventoryPriceOperationDto> {
    await setGuardedPriceTxALockTimeout(tx);
    await acquireGuardedPriceAdvisoryLock(
      tx,
      params.tenantId,
      params.principalId,
      params.operationKey,
    );

    const foreignRow = await tx.inventoryPriceOperation.findFirst({
      where: {
        tenant_id: params.tenantId,
        key: params.operationKey,
        NOT: { principal_id: params.principalId },
      },
    });
    if (foreignRow) {
      throw new NotFoundException(
        `Price operation ${params.operationKey} not found`,
      );
    }

    let existing = await tx.inventoryPriceOperation.findFirst({
      where: {
        tenant_id: params.tenantId,
        principal_id: params.principalId,
        key: params.operationKey,
      },
    });

    if (!existing) {
      return await this.fenceWithNoRow(tx, params);
    }

    if (!frozenIntentMatchesRow(existing, params.intent)) {
      idempotencyKeyReused(
        'Operation key was already used with a different intent.',
      );
    }

    await lockGuardedPriceJournalRow(tx, params.tenantId, existing.id);
    existing = await tx.inventoryPriceOperation.findFirstOrThrow({
      where: { tenant_id: params.tenantId, id: existing.id },
    });

    return await this.fenceExistingRow(tx, params.tenantId, existing);
  }

  private async fenceWithNoRow(
    tx: Prisma.TransactionClient,
    params: {
      tenantId: string;
      principalId: string;
      operationKey: string;
      intent: GuardedPriceIntent;
    },
  ): Promise<InventoryPriceOperationDto> {
    const insideWindow = isKeyInsideAdmissionWindow(params.operationKey);

    const raced = await tx.inventoryPriceOperation.findFirst({
      where: {
        tenant_id: params.tenantId,
        principal_id: params.principalId,
        key: params.operationKey,
      },
    });
    if (raced) {
      if (!frozenIntentMatchesRow(raced, params.intent)) {
        idempotencyKeyReused(
          'Operation key was already used with a different intent.',
        );
      }
      await lockGuardedPriceJournalRow(tx, params.tenantId, raced.id);
      const fresh = await tx.inventoryPriceOperation.findFirstOrThrow({
        where: { tenant_id: params.tenantId, id: raced.id },
      });
      return await this.fenceExistingRow(tx, params.tenantId, fresh);
    }

    if (!insideWindow) {
      outcomeUnavailable('No durable outcome exists for this operation key.');
    }

    const created = await tx.inventoryPriceOperation.create({
      data: {
        tenant_id: params.tenantId,
        principal_id: params.principalId,
        key: params.operationKey,
        item_id: params.intent.itemId,
        sku: params.intent.sku,
        kind: GUARDED_PRICE_KIND,
        expected_revision: BigInt(params.intent.expectedRevision),
        target_minor: params.intent.targetMinor,
        basis_minor: params.intent.basisMinor,
        state: InventoryPriceOperationState.FENCED,
        accepted_at: new Date(),
        final_at: new Date(),
        error_code: 'OPERATION_FENCED',
      },
    });

    return mapInventoryPriceOperation(created);
  }

  private async fenceExistingRow(
    tx: Prisma.TransactionClient,
    tenantId: string,
    row: Prisma.InventoryPriceOperationGetPayload<object>,
  ): Promise<InventoryPriceOperationDto> {
    if (row.state === InventoryPriceOperationState.FENCED) {
      return mapInventoryPriceOperation(row);
    }
    if (row.state === InventoryPriceOperationState.CONFLICT) {
      return mapInventoryPriceOperation(row);
    }
    if (row.state === InventoryPriceOperationState.APPLIED) {
      return mapInventoryPriceOperation(row);
    }
    if (row.state !== InventoryPriceOperationState.ACCEPTED) {
      operationUnresolved('Guarded operation is in an unknown state.');
    }

    const leaseEnd = row.accepted_at.getTime() + GUARDED_PRICE_LEASE_MS;
    if (Date.now() < leaseEnd) {
      operationUnresolved('Guarded operation acceptance is still within lease.');
    }

    const updated = await tx.inventoryPriceOperation.update({
      where: { tenant_id_id: { tenant_id: tenantId, id: row.id } },
      data: {
        state: InventoryPriceOperationState.FENCED,
        final_at: new Date(),
        error_code: 'OPERATION_FENCED',
      },
    });

    return mapInventoryPriceOperation(updated);
  }

  private async resolveFenceIntent(
    tenantId: string,
    body: UserFenceInventoryPriceDto,
  ): Promise<GuardedPriceIntent> {
    const item = await this.prisma.catalogItem.findFirst({
      where: { id: body.itemId, tenant_id: tenantId },
    });
    if (!item) {
      throw new NotFoundException(`Catalog item ${body.itemId} not found`);
    }

    const expectedRevision = parseExpectedRevision(body.expectedRevision);
    const targetMinor = retailMajorToMinorUnits(body.retail_price);

    return {
      itemId: body.itemId,
      expectedRevision,
      targetMinor,
      basisMinor: retailMajorToMinorUnits(Number(item.retail_price)),
      sku: item.sku,
    };
  }

  private requirePrincipalId(): string {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user?.userId) {
      throw new NotFoundException('Authenticated principal is required.');
    }
    return user.userId;
  }
}

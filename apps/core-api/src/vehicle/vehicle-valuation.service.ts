import {
  BadRequestException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { VehicleInventoryRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { SiteContextService } from '../site/site-context.service.js';
import type { CreateVehicleValuationDto } from './dto/vehicle-valuation.dto.js';
import {
  valuationConflictReplay,
  valuationIdempotencyKeyInvalid,
  valuationMissingData,
  valuationProviderResult,
  valuationProviderUnavailable,
  valuationSiteRequired,
  valuationTypeUnsupported,
  valuationUncertainIdentity,
  valuationVehicleNotFound,
} from './vehicle-valuation.errors.js';
import {
  buildProviderFailureBody,
  buildQuotedResponseFromOutput,
  mapSnapshotToQuotedResponse,
} from './vehicle-valuation.mapper.js';
import {
  VEHICLE_VALUATION_PROVIDER,
  VALUATION_CONTRACT_VERSION,
  type ValuationCondition,
  type ValuationQuoteOutput,
  type VehicleValuationProvider,
} from './vehicle-valuation.provider.js';
import {
  assessNationalCodeIdentity,
  assertRequestedAsOfInRange,
  createValuationInputSha256,
  hashValuationProviderBody,
  resolveRequestedAsOf,
  VALUATION_IDEMPOTENCY_KEY_PATTERN,
} from './vehicle-valuation.util.js';

const STOCK_ROLES: VehicleInventoryRole[] = [
  VehicleInventoryRole.USED,
  VehicleInventoryRole.NEW,
  VehicleInventoryRole.DEMO,
];

@Injectable()
export class VehicleValuationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    @Inject(VEHICLE_VALUATION_PROVIDER)
    private readonly provider: VehicleValuationProvider,
  ) {}

  async listValuations(vehicleId: string, now: Date = new Date()) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertVehicleReadable(tenantId, vehicleId);

    const rows = await this.prisma.vehicleValuationSnapshot.findMany({
      where: { tenant_id: tenantId, vehicle_id: vehicleId },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((row) => mapSnapshotToQuotedResponse(row, now));
  }

  async createValuation(
    vehicleId: string,
    dto: CreateVehicleValuationDto,
    idempotencyKeyHeader: string | undefined,
    now: Date = new Date(),
  ) {
    const idempotencyKey = this.validateIdempotencyKey(idempotencyKeyHeader);
    if (dto.valuationType !== 'MARKET_VALUE') {
      throw valuationTypeUnsupported();
    }
    if (dto.currency !== 'EUR') {
      throw new UnprocessableEntityException({
        code: 'VALUATION_CURRENCY_UNSUPPORTED',
        result: 'CURRENCY_CONFLICT',
      });
    }

    const tenantId = await this.tenantContext.getTenantId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const vehicle = await this.loadVehicleForQuote(tenantId, vehicleId);
    const missing = this.collectMissingFields(dto);
    if (missing.length > 0) {
      throw valuationMissingData({
        result: 'MISSING_DATA',
        missing,
        amount: null,
        sourceState: 'UNKNOWN',
        asOfState: 'AS_OF_UNKNOWN',
        referenceVersionState: 'REFERENCE_VERSION_UNKNOWN',
        nativeId: null,
        nativeIdState: 'NATIVE_ID_UNKNOWN',
      });
    }

    const identity = assessNationalCodeIdentity({
      nationalCode: vehicle.national_code,
      vin: vehicle.vin,
      typenscheinNo: vehicle.typenschein_no,
    });
    if (!identity.ok) {
      const requestedAsOf = resolveRequestedAsOf(dto.requestedAsOf, now);
      throw valuationUncertainIdentity({
        result: 'UNCERTAIN_IDENTITY',
        amount: null,
        currency: null,
        source: null,
        sourceState: 'UNKNOWN',
        requestedAsOf,
        providerAsOf: null,
        asOfState: 'AS_OF_UNKNOWN',
        referenceVersion: null,
        referenceVersionState: 'REFERENCE_VERSION_UNKNOWN',
        contractVersion: VALUATION_CONTRACT_VERSION,
        nativeId: null,
        nativeIdState: 'NATIVE_ID_UNKNOWN',
      });
    }

    const requestedAsOf = resolveRequestedAsOf(dto.requestedAsOf, now);
    try {
      assertRequestedAsOfInRange(
        requestedAsOf,
        vehicle.first_registration_date,
        now,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Invalid requestedAsOf';
      throw new BadRequestException({
        code: message,
        message,
        field: 'requestedAsOf',
      });
    }

    const mileageKm = dto.mileageKm as number;
    const condition = dto.condition as ValuationCondition;
    const inputSha256 = createValuationInputSha256({
      vehicleId,
      nationalCode: identity.nationalCode,
      valuationType: 'MARKET_VALUE',
      mileageKm,
      condition,
      requestedAsOf,
      currency: 'EUR',
      contractVersion: VALUATION_CONTRACT_VERSION,
    });

    const existing = await this.prisma.vehicleValuationSnapshot.findFirst({
      where: { tenant_id: tenantId, idempotency_key: idempotencyKey },
    });
    if (existing) {
      if (existing.input_sha256 !== inputSha256) {
        throw valuationConflictReplay({
          result: 'CONFLICT_REPLAY',
          amount: null,
          sourceState: 'UNKNOWN',
          asOfState: 'AS_OF_UNKNOWN',
          referenceVersionState: 'REFERENCE_VERSION_UNKNOWN',
          nativeId: null,
          nativeIdState: 'NATIVE_ID_UNKNOWN',
        });
      }
      return mapSnapshotToQuotedResponse(existing, now);
    }

    if (!this.provider.isAvailable()) {
      throw valuationProviderUnavailable();
    }

    const providerOutput = await this.provider.quote(
      {
        market: 'AT',
        valuationType: 'MARKET_VALUE',
        nationalCode: identity.nationalCode,
        mileageKm,
        condition,
        requestedAsOf,
        currency: 'EUR',
        contractVersion: VALUATION_CONTRACT_VERSION,
      },
      AbortSignal.timeout(30_000),
    );

    if (providerOutput.result !== 'QUOTED') {
      this.mapProviderFailure(providerOutput, requestedAsOf);
    }

    if (
      !providerOutput.amount ||
      !providerOutput.providerAsOf ||
      !providerOutput.referenceVersion ||
      providerOutput.currency !== 'EUR'
    ) {
      this.mapProviderFailure(providerOutput, requestedAsOf);
    }

    const siteId = this.resolveSnapshotSiteId(vehicle);
    const snapshotId = randomUUID();
    const createdAt = now;
    const providerBodySha256 = hashValuationProviderBody(providerOutput);

    const row = await this.prisma.vehicleValuationSnapshot.create({
      data: {
        id: snapshotId,
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        site_id: siteId,
        national_code: identity.nationalCode,
        valuation_type: 'MARKET_VALUE',
        mileage_km: mileageKm,
        condition,
        requested_as_of: new Date(`${requestedAsOf}T00:00:00.000Z`),
        provider_as_of: new Date(
          `${providerOutput.providerAsOf}T00:00:00.000Z`,
        ),
        currency: 'EUR',
        amount: providerOutput.amount,
        source: 'EUROTAX_AT_AUTOVALUATION',
        reference_version: providerOutput.referenceVersion,
        contract_version: VALUATION_CONTRACT_VERSION,
        native_id_state: 'NATIVE_ID_UNKNOWN',
        input_sha256: inputSha256,
        provider_body_sha256: providerBodySha256,
        idempotency_key: idempotencyKey,
        created_by: user.id,
        createdAt,
      },
    });

    return buildQuotedResponseFromOutput(
      {
        id: row.id,
        nationalCode: identity.nationalCode,
        mileageKm,
        condition,
        requestedAsOf,
        createdAt: row.createdAt,
      },
      {
        amount: providerOutput.amount,
        providerAsOf: providerOutput.providerAsOf,
        referenceVersion: providerOutput.referenceVersion,
      },
      now,
    );
  }

  private validateIdempotencyKey(idempotencyKey: string | undefined): string {
    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
    if (!VALUATION_IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw valuationIdempotencyKeyInvalid();
    }
    return key;
  }

  private collectMissingFields(dto: CreateVehicleValuationDto): string[] {
    const missing: string[] = [];
    if (dto.mileageKm === undefined || dto.mileageKm === null) {
      missing.push('mileageKm');
    }
    if (dto.condition === undefined || dto.condition === null) {
      missing.push('condition');
    }
    return missing;
  }

  private mapProviderFailure(
    output: ValuationQuoteOutput,
    requestedAsOf: string,
  ): never {
    const body = buildProviderFailureBody(output.result, output, requestedAsOf);
    const statusCode =
      output.result === 'AMBIGUOUS_VARIANT'
        ? 409
        : output.result === 'CURRENCY_CONFLICT' ||
            output.result === 'REFERENCE_VERSION_UNKNOWN' ||
            output.result === 'AS_OF_UNKNOWN'
          ? 422
          : 422;
    throw valuationProviderResult(statusCode, body);
  }

  private resolveSnapshotSiteId(vehicle: {
    inventory_role: VehicleInventoryRole;
    site_id: string | null;
  }): string | null {
    if (!STOCK_ROLES.includes(vehicle.inventory_role)) {
      return null;
    }
    return vehicle.site_id;
  }

  private async loadVehicleForQuote(tenantId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      select: {
        id: true,
        vin: true,
        typenschein_no: true,
        national_code: true,
        first_registration_date: true,
        inventory_role: true,
        site_id: true,
      },
    });
    if (!vehicle) {
      throw valuationVehicleNotFound(vehicleId);
    }

    if (STOCK_ROLES.includes(vehicle.inventory_role)) {
      if (!vehicle.site_id) {
        throw valuationSiteRequired();
      }
      const activeSiteId = await this.siteContext.getSiteId();
      if (vehicle.site_id !== activeSiteId) {
        throw valuationVehicleNotFound(vehicleId);
      }
    }

    return vehicle;
  }

  private async assertVehicleReadable(tenantId: string, vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      select: { id: true, inventory_role: true, site_id: true },
    });
    if (!vehicle) {
      throw valuationVehicleNotFound(vehicleId);
    }
    if (STOCK_ROLES.includes(vehicle.inventory_role)) {
      if (!vehicle.site_id) {
        throw valuationSiteRequired();
      }
      const activeSiteId = await this.siteContext.getSiteId();
      if (vehicle.site_id !== activeSiteId) {
        throw valuationVehicleNotFound(vehicleId);
      }
    }
  }
}

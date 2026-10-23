import { withPlateNormalized } from '../vehicle/vehicle-plate.util.js';
import {
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VehicleRecordSource } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import {
  VEHICLE_IDENTITY_RESET,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
} from '../vehicle/vehicle-identity.util.js';
import {
  partyWriteContext,
  setOwnerInTx,
} from '../vehicle/vehicle-party.writer.js';
import { createNewIntakeVehicle } from '../workshop/workshop-intake-vehicle.helpers.js';
import type {
  RegistrationFieldEvidence,
  RegistrationMatchSnapshot,
} from './registration-document-extraction.types.js';
import { resolveApplyTargets } from './registration-intake-apply-targets.js';
import {
  assertStoredRegulatoryFieldsMatchConfirmation,
  buildFillBlankRegulatoryUpdate,
} from './registration-intake-vehicle-field-guards.js';
import { isLowConfidence } from './registration-intake-evidence.normalizer.js';
import {
  registrationAmbiguousMatch,
  registrationConfirmationMismatch,
  registrationConflictingVin,
  registrationFieldConflict,
  registrationIllegible,
  registrationIntakeNotFound,
  registrationInvalidVin,
  registrationLowConfidence,
  registrationNationalcodeLooksLikeVin,
  registrationOwnershipConflict,
  registrationStateChanged,
  registrationVehicleIdentityIncomplete,
  registrationWrongDocument,
} from './registration-intake.errors.js';
import {
  REGISTRATION_INTAKE_BYTE_STORAGE,
  type RegistrationIntakeByteStorage,
} from './registration-intake-byte-storage.js';
import type { ApplyRegistrationIntakeDto } from './dto/apply-registration-intake.dto.js';
import { assertRegistrationIntakeRole } from './registration-intake.authorization.js';

function holdersEqual(
  a: { firstName: string; lastName: string },
  b: { firstName: string; lastName: string },
): boolean {
  return (
    a.firstName.trim().toLowerCase() === b.firstName.trim().toLowerCase() &&
    a.lastName.trim().toLowerCase() === b.lastName.trim().toLowerCase()
  );
}

@Injectable()
export class RegistrationIntakeApplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    @Inject(REGISTRATION_INTAKE_BYTE_STORAGE)
    private readonly byteStorage: RegistrationIntakeByteStorage,
  ) {}

  async apply(intakeId: string, dto: ApplyRegistrationIntakeDto) {
    assertRegistrationIntakeRole(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await requireActiveCurrentUser(this.prisma, this.tenantContext, tenantId);

    const intake = await this.prisma.registrationDocumentIntake.findFirst({
      where: { id: intakeId, tenant_id: tenantId, site_id: siteId },
    });
    if (!intake) {
      throw registrationIntakeNotFound(intakeId);
    }
    if (intake.state === 'APPLIED') {
      return this.buildAppliedResponse(intake);
    }
    if (intake.state !== 'AWAITING_REVIEW') {
      throw registrationStateChanged();
    }

    const evidence = intake.evidence as {
      documentKind: string;
      warnings: string[];
      fields: Record<string, RegistrationFieldEvidence>;
    } | null;
    const snapshot = intake.match_snapshot as RegistrationMatchSnapshot | null;
    const cases = snapshot?.cases ?? [];
    const fields = evidence?.fields ?? {};

    if (evidence?.documentKind !== 'AT_ZULASSUNGSSCHEIN') {
      throw registrationWrongDocument();
    }
    if (evidence?.warnings.includes('ILLEGIBLE')) {
      throw registrationIllegible();
    }
    if (cases.includes('LOW_CONFIDENCE')) {
      throw registrationLowConfidence();
    }
    if (cases.includes('INVALID_VIN')) {
      throw registrationInvalidVin();
    }
    if (cases.includes('NATIONALCODE_LOOKS_LIKE_VIN')) {
      throw registrationNationalcodeLooksLikeVin();
    }
    if (cases.includes('DUPLICATE_CUSTOMERS')) {
      const chosen = dto.customerId;
      if (
        !chosen ||
        !snapshot?.customers.some((customer) => customer.id === chosen)
      ) {
        throw registrationAmbiguousMatch();
      }
    }
    if (cases.includes('DUPLICATE_VEHICLES')) {
      const chosen = dto.vehicleId;
      if (
        !chosen ||
        !snapshot?.vehicles.some((vehicle) => vehicle.id === chosen)
      ) {
        throw registrationAmbiguousMatch();
      }
    }
    if (cases.includes('OWNERSHIP_CONFLICT') && !dto.ownershipCorrection) {
      throw registrationOwnershipConflict();
    }
    if (
      cases.includes('NATIONALCODE_CONFLICT') ||
      cases.includes('FIRST_REGISTRATION_CONFLICT') ||
      cases.includes('CO2_CONFLICT')
    ) {
      throw registrationFieldConflict();
    }

    this.assertConfirmationMatches(fields, dto, cases);

    if (dto.vehicleId && cases.includes('CONFLICTING_VIN')) {
      throw registrationConflictingVin();
    }

    const targets = resolveApplyTargets(snapshot, dto, cases);
    if (targets.customerId) {
      await this.assertTenantCustomer(
        this.prisma,
        tenantId,
        targets.customerId,
      );
    }
    if (dto.ownershipCorrection?.nextCustomerId) {
      await this.assertTenantCustomer(
        this.prisma,
        tenantId,
        dto.ownershipCorrection.nextCustomerId,
      );
    }
    if (targets.vehicleId) {
      await this.assertTenantVehicle(this.prisma, tenantId, targets.vehicleId);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.registrationDocumentIntake.updateMany({
        where: {
          id: intakeId,
          tenant_id: tenantId,
          site_id: siteId,
          state: 'AWAITING_REVIEW',
        },
        data: { state: 'RUNNING' },
      });
      if (locked.count !== 1) {
        throw registrationStateChanged();
      }

      let customerId = targets.customerId;
      if (targets.createCustomer) {
        const holder = fields.holder?.normalized as {
          firstName: string;
          lastName: string;
        };
        const created = await tx.customer.create({
          data: {
            tenant_id: tenantId,
            first_name: holder.firstName,
            last_name: holder.lastName,
            type: 'PRIVATE',
          },
        });
        customerId = created.id;
      } else {
        await this.assertTenantCustomer(tx, tenantId, customerId!);
      }

      let vehicleId = targets.vehicleId;
      let createdVehicle = false;
      const createdCustomer = targets.createCustomer;

      if (targets.createVehicle) {
        const vin = normalizeVehicleIdentityValueOrNull(dto.vin);
        const make = dto.make!;
        const model = dto.model!;
        const year = dto.year!;
        const vehicle = await createNewIntakeVehicle({
          tx,
          tenantId,
          customerId: customerId!,
          vin,
          dto: {
            plate: dto.plate,
            make,
            model,
            year,
            vin: dto.vin ?? '',
          },
        });
        vehicleId = vehicle.id;
        createdVehicle = true;
        await this.applyRegulatoryFieldUpdates(tx, tenantId, vehicleId, dto);
      } else {
        await this.updateExistingVehicle(
          tx,
          tenantId,
          vehicleId!,
          customerId!,
          dto,
        );
      }

      const strippedEvidence = this.stripHolderRaw(evidence);
      const updated = await tx.registrationDocumentIntake.update({
        where: { id: intakeId },
        data: {
          state: 'APPLIED',
          applied_customer_id: customerId,
          applied_vehicle_id: vehicleId,
          evidence: strippedEvidence as unknown as PrismaTypes.InputJsonValue,
          match_snapshot: Prisma.JsonNull,
        },
      });

      if (!DryRunStorage.isDryRun()) {
        const existingPurge = await tx.registrationIntakeBytePurge.findFirst({
          where: { tenant_id: tenantId, intake_id: intakeId },
        });
        if (!existingPurge) {
          await tx.registrationIntakeBytePurge.create({
            data: {
              tenant_id: tenantId,
              intake_id: intakeId,
              object_prefix: this.byteStorage.intakeObjectPrefix(
                tenantId,
                intakeId,
              ),
            },
          });
        }
      }

      return {
        state: 'APPLIED' as const,
        createdCustomer,
        createdVehicle,
        customerId,
        vehicleId,
        workshopOrderId: null,
        capturedSiteId: updated.site_id,
        bytesDeleted: false,
        bytePurgeQueued: !DryRunStorage.isDryRun(),
      };
    });

    return result;
  }

  private buildAppliedResponse(intake: {
    applied_customer_id: string | null;
    applied_vehicle_id: string | null;
    applied_workshop_order_id: string | null;
    site_id: string;
  }) {
    return {
      state: 'APPLIED' as const,
      createdCustomer: false,
      createdVehicle: false,
      customerId: intake.applied_customer_id,
      vehicleId: intake.applied_vehicle_id,
      workshopOrderId: intake.applied_workshop_order_id,
      capturedSiteId: intake.site_id,
      bytesDeleted: false,
      bytePurgeQueued: false,
    };
  }

  private stripHolderRaw(
    evidence: {
      documentKind: string;
      warnings: string[];
      fields: Record<string, RegistrationFieldEvidence>;
    } | null,
  ) {
    if (!evidence) return evidence;
    const holder = evidence.fields.holder;
    if (!holder) return evidence;
    return {
      ...evidence,
      fields: {
        ...evidence.fields,
        holder: { ...holder, raw: null },
      },
    };
  }

  private assertConfirmationMatches(
    fields: Record<string, RegistrationFieldEvidence>,
    dto: ApplyRegistrationIntakeDto,
    cases: string[],
  ) {
    const vinNorm =
      typeof fields.vin?.normalized === 'string' ? fields.vin.normalized : null;
    if (dto.vin !== vinNorm) {
      throw registrationConfirmationMismatch();
    }
    const plateNorm =
      typeof fields.plate?.normalized === 'string'
        ? fields.plate.normalized
        : null;
    if (dto.plate !== plateNorm) {
      throw registrationConfirmationMismatch();
    }
    const holder = fields.holder?.normalized as
      { firstName: string; lastName: string } | undefined;
    if (!holder || !holdersEqual(holder, dto.holder)) {
      throw registrationConfirmationMismatch();
    }
    const codeNorm =
      typeof fields.nationalcode?.normalized === 'string'
        ? fields.nationalcode.normalized
        : null;
    if (cases.includes('MISSING_NATIONALCODE')) {
      if (dto.nationalcode !== null) {
        throw registrationConfirmationMismatch();
      }
    } else if (dto.nationalcode !== codeNorm) {
      throw registrationConfirmationMismatch();
    }

    const firstRegNorm =
      typeof fields.firstRegistration?.normalized === 'string'
        ? fields.firstRegistration.normalized
        : null;
    if (dto.firstRegistration !== firstRegNorm) {
      throw registrationConfirmationMismatch();
    }

    const co2Field = fields.co2 as
      (RegistrationFieldEvidence & { cycle?: 'WLTP' | 'NEDC' }) | undefined;
    const co2Norm =
      typeof co2Field?.normalized === 'number' ? co2Field.normalized : null;
    const co2CycleKnown =
      co2Field?.cycle === 'WLTP' || co2Field?.cycle === 'NEDC';
    const co2CycleUnknown =
      cases.includes('CO2_CYCLE_UNKNOWN') ||
      (co2Norm !== null && !co2CycleKnown);
    if (co2CycleUnknown) {
      if (dto.co2 !== null && dto.co2 !== undefined) {
        throw registrationConfirmationMismatch();
      }
    } else if (dto.co2) {
      if (
        co2Norm === null ||
        dto.co2.value !== co2Norm ||
        dto.co2.cycle !== co2Field?.cycle
      ) {
        throw registrationConfirmationMismatch();
      }
    } else if (co2Norm !== null) {
      throw registrationConfirmationMismatch();
    }

    if (!cases.includes('EXISTING_VEHICLE')) {
      if (!dto.make || !dto.model || !dto.year) {
        throw registrationVehicleIdentityIncomplete();
      }
      for (const key of ['make', 'model', 'year'] as const) {
        const field = fields[key];
        if (field && !isLowConfidence(field) && field.normalized !== null) {
          if (dto[key] !== field.normalized) {
            throw registrationConfirmationMismatch();
          }
        }
      }
    }
  }

  private async assertTenantCustomer(
    prisma: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    customerId: string,
  ): Promise<void> {
    const row = await prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException(`Customer ${customerId} not found`);
    }
  }

  private async assertTenantVehicle(
    prisma: PrismaService | Prisma.TransactionClient,
    tenantId: string,
    vehicleId: string,
  ): Promise<void> {
    const row = await prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
  }

  private async updateExistingVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vehicleId: string,
    customerId: string,
    dto: ApplyRegistrationIntakeDto,
  ) {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });
    if (!vehicle) {
      throw registrationIntakeNotFound(vehicleId);
    }

    assertStoredRegulatoryFieldsMatchConfirmation(vehicle, dto);

    if (
      vehicle.customer_id &&
      vehicle.customer_id !== customerId &&
      !dto.ownershipCorrection
    ) {
      throw registrationOwnershipConflict();
    }

    if (dto.ownershipCorrection) {
      if (dto.ownershipCorrection.expectedCustomerId !== vehicle.customer_id) {
        throw new ConflictException(
          'Vehicle holder changed while confirming intake; please retry',
        );
      }
      await this.assertTenantCustomer(
        tx,
        tenantId,
        dto.ownershipCorrection.nextCustomerId,
      );
      if (dto.ownershipCorrection.nextCustomerId !== customerId) {
        throw registrationOwnershipConflict();
      }
    }

    const plateChanged =
      normalizeVehicleIdentityValue(vehicle.plate) !==
      normalizeVehicleIdentityValue(dto.plate);
    const updated = await tx.vehicle.updateMany({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        vin: vehicle.vin,
        plate: vehicle.plate,
        identity_resolution_generation:
          vehicle.identity_resolution_generation ?? null,
        identity_resolution_token: vehicle.identity_resolution_token ?? null,
        ...(dto.ownershipCorrection
          ? { customer_id: dto.ownershipCorrection.expectedCustomerId }
          : {}),
      },
      data: withPlateNormalized({
        plate: dto.plate,
        ...(plateChanged
          ? { ...VEHICLE_IDENTITY_RESET, identity_resolution_token: null }
          : {}),
      }),
    });
    if (updated.count === 0) {
      throw new ConflictException(
        dto.ownershipCorrection
          ? 'Vehicle holder changed while confirming intake; please retry'
          : 'Vehicle VIN or plate changed while registering intake; please retry',
      );
    }

    await this.applyOwnershipCorrection(tx, tenantId, vehicleId, dto);
    await this.applyRegulatoryFieldUpdates(tx, tenantId, vehicleId, dto);
  }

  /** The corrected holder becomes the OWNER; customer_id follows through the party writer. */
  private async applyOwnershipCorrection(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vehicleId: string,
    dto: ApplyRegistrationIntakeDto,
  ) {
    if (!dto.ownershipCorrection) {
      return;
    }
    await setOwnerInTx(
      tx,
      partyWriteContext(tenantId),
      vehicleId,
      dto.ownershipCorrection.nextCustomerId,
      VehicleRecordSource.MANUAL,
    );
  }

  private async applyRegulatoryFieldUpdates(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vehicleId: string,
    dto: ApplyRegistrationIntakeDto,
  ) {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });
    if (!vehicle) return;
    assertStoredRegulatoryFieldsMatchConfirmation(vehicle, dto);
    const data = buildFillBlankRegulatoryUpdate(vehicle, dto);
    if (Object.keys(data).length > 0) {
      await tx.vehicle.updateMany({
        where: { id: vehicleId, tenant_id: tenantId },
        data,
      });
    }
  }
}

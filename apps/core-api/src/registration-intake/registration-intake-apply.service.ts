import {
  ConflictException,
  Injectable,
  Inject,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { createHash } from 'node:crypto';
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
import { createNewIntakeVehicle } from '../workshop/workshop-intake-vehicle.helpers.js';
import type { RegistrationFieldEvidence } from './registration-document-extraction.types.js';
import {
  isLowConfidence,
  VIN_PATTERN,
} from './registration-intake-evidence.normalizer.js';
import {
  registrationAmbiguousMatch,
  registrationAppliedDelete,
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
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

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
    const snapshot = intake.match_snapshot as {
      cases: string[];
    } | null;
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
    if (cases.includes('DUPLICATE_CUSTOMERS') || cases.includes('DUPLICATE_VEHICLES')) {
      throw registrationAmbiguousMatch();
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

      let customerId = dto.customerId;
      if (!customerId) {
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
      }

      let vehicleId = dto.vehicleId;
      let createdVehicle = false;
      let createdCustomer = !dto.customerId;

      if (!vehicleId) {
        const vin = normalizeVehicleIdentityValueOrNull(dto.vin);
        const make = dto.make!;
        const model = dto.model!;
        const year = dto.year!;
        const vehicle = await createNewIntakeVehicle({
          tx,
          tenantId,
          customerId,
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
        await this.fillBlankVehicleFields(tx, tenantId, vehicleId, dto, fields);
      } else {
        await this.updateExistingVehicle(tx, tenantId, vehicleId, customerId, dto, fields, cases);
        createdCustomer = false;
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
        const existingPurge = await tx.registrationIntakeBytePurge.findUnique({
          where: { intake_id: intakeId },
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
      | { firstName: string; lastName: string }
      | undefined;
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

    if (!dto.vehicleId) {
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

  private async updateExistingVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vehicleId: string,
    customerId: string,
    dto: ApplyRegistrationIntakeDto,
    fields: Record<string, RegistrationFieldEvidence>,
    cases: string[],
  ) {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });
    if (!vehicle) {
      throw registrationIntakeNotFound(vehicleId);
    }

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
      customerId = dto.ownershipCorrection.nextCustomerId;
    }

    const vin = normalizeVehicleIdentityValueOrNull(dto.vin);
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
      data: {
        plate: dto.plate,
        ...(dto.ownershipCorrection
          ? { customer_id: dto.ownershipCorrection.nextCustomerId }
          : {}),
        ...(plateChanged
          ? { ...VEHICLE_IDENTITY_RESET, identity_resolution_token: null }
          : {}),
      },
    });
    if (updated.count === 0) {
      throw new ConflictException(
        dto.ownershipCorrection
          ? 'Vehicle holder changed while confirming intake; please retry'
          : 'Vehicle VIN or plate changed while registering intake; please retry',
      );
    }

    await this.fillBlankVehicleFields(tx, tenantId, vehicleId, dto, fields);
  }

  private async fillBlankVehicleFields(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vehicleId: string,
    dto: ApplyRegistrationIntakeDto,
    fields: Record<string, RegistrationFieldEvidence>,
  ) {
    const vehicle = await tx.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });
    if (!vehicle) return;
    const data: Prisma.VehicleUpdateInput = {};
    if (!vehicle.national_code && dto.nationalcode) {
      data.national_code = dto.nationalcode;
    }
    if (!vehicle.first_registration_date && dto.firstRegistration) {
      data.first_registration_date = new Date(dto.firstRegistration);
    }
    if (dto.co2) {
      if (dto.co2.cycle === 'WLTP' && vehicle.co2_wltp_g_km === null) {
        data.co2_wltp_g_km = dto.co2.value;
      }
      if (dto.co2.cycle === 'NEDC' && vehicle.co2_nedc_g_km === null) {
        data.co2_nedc_g_km = dto.co2.value;
      }
    }
    if (Object.keys(data).length > 0) {
      await tx.vehicle.updateMany({
        where: { id: vehicleId, tenant_id: tenantId },
        data,
      });
    }
  }
}

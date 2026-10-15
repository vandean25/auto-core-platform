import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { RegistrationDocumentIntakeState } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { requireActiveCurrentUser } from '../site/site.authorization.js';
import {
  REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER,
  type RegistrationDocumentExtractionProvider,
} from './registration-document-extraction-provider.js';
import { REGISTRATION_DOCUMENT_PROMPT_VERSION } from './registration-document-extraction.types.js';
import {
  mergeRegistrationFieldMaps,
  normalizeRegistrationEvidenceFields,
} from './registration-intake-evidence.normalizer.js';
import { RegistrationIntakeMatchService } from './registration-intake-match.service.js';
import { detectRegistrationIntakeMime } from './registration-intake-mime.js';
import {
  REGISTRATION_INTAKE_BYTE_STORAGE,
  type RegistrationIntakeByteStorage,
} from './registration-intake-byte-storage.js';
import {
  registrationAppliedDelete,
  registrationBytesRemain,
  registrationIdempotencyConflict,
  registrationIdempotencyKeyInvalid,
  registrationInProgress,
  registrationIntakeNotFound,
  registrationStateChanged,
  registrationStoreFailed,
  registrationUnsupportedFile,
} from './registration-intake.errors.js';
import {
  REGISTRATION_INTAKE_EXPIRY_DAYS,
  REGISTRATION_INTAKE_IDEMPOTENCY_KEY_PATTERN,
  REGISTRATION_INTAKE_MAX_FILES,
} from './registration-intake-limits.js';
import { assertRegistrationIntakeRole } from './registration-intake.authorization.js';
import type { CreateWorkshopOrderDto } from '../workshop/dto/create-workshop-order.dto.js';
import { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import { RegistrationIntakeApplyService } from './registration-intake-apply.service.js';
import type { ApplyRegistrationIntakeDto } from './dto/apply-registration-intake.dto.js';
import { coerceRegistrationIntakeUploadFiles } from './registration-intake-upload.validation.js';

const FINISHED_STATES: RegistrationDocumentIntakeState[] = [
  'AWAITING_REVIEW',
  'FAILED',
  'ABORTED',
  'APPLIED',
];

const IN_PROGRESS_STATES: RegistrationDocumentIntakeState[] = [
  'UPLOADED',
  'QUEUED',
  'RUNNING',
];

@Injectable()
export class RegistrationIntakeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    private readonly matchService: RegistrationIntakeMatchService,
    private readonly applyService: RegistrationIntakeApplyService,
    private readonly workshopIntake: WorkshopIntakeService,
    @Inject(REGISTRATION_INTAKE_BYTE_STORAGE)
    private readonly byteStorage: RegistrationIntakeByteStorage,
    @Optional()
    @Inject(REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER)
    private readonly provider: RegistrationDocumentExtractionProvider,
  ) {}

  async create(
    filesInput: Express.Multer.File[],
    sides: Array<'FRONT' | 'BACK'>,
    idempotencyKey: string,
  ) {
    const files = coerceRegistrationIntakeUploadFiles(filesInput);
    assertRegistrationIntakeRole(this.tenantContext);
    this.validateIdempotencyKey(idempotencyKey);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const user = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );

    const requestHash = this.computeRequestHash(files, sides, user.id, siteId);

    const existing = await this.prisma.registrationDocumentIntake.findFirst({
      where: {
        tenant_id: tenantId,
        captured_by_user_id: user.id,
        site_id: siteId,
        idempotency_key: idempotencyKey,
      },
    });
    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw registrationIdempotencyConflict();
      }
      if (IN_PROGRESS_STATES.includes(existing.state)) {
        throw registrationInProgress();
      }
      if (FINISHED_STATES.includes(existing.state)) {
        return this.toCreateResponse(existing);
      }
    }

    if (!this.provider.isAvailable()) {
      throw new ServiceUnavailableException({
        code: 'REGISTRATION_EXTRACTION_UNAVAILABLE',
        message:
          'REGISTRATION_EXTRACTION_UNAVAILABLE: Registration document extraction is not currently available.',
      });
    }

    if (files.length > REGISTRATION_INTAKE_MAX_FILES) {
      throw registrationUnsupportedFile();
    }
    for (const file of files) {
      const mime = detectRegistrationIntakeMime(file.buffer);
      if (!mime) {
        throw registrationUnsupportedFile();
      }
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REGISTRATION_INTAKE_EXPIRY_DAYS);
    const intakeId = randomUUID();
    const leaseToken = randomBytes(16).toString('hex');

    await this.prisma.registrationDocumentIntake.create({
      data: {
        id: intakeId,
        tenant_id: tenantId,
        site_id: siteId,
        captured_by_user_id: user.id,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        state: 'UPLOADED',
        lease_token: leaseToken,
        expires_at: expiresAt,
      },
    });

    let pageNo = 1;
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const mime = detectRegistrationIntakeMime(file.buffer)!;
        const side = sides[i] ?? 'FRONT';
        const page = side === 'BACK' ? 2 : pageNo++;
        await this.byteStorage.storePage({
          tenantId,
          intakeId,
          page,
          bytes: file.buffer,
          contentType: mime,
        });
      }
    } catch {
      await this.byteStorage.deleteIntakePrefix({ tenantId, intakeId });
      await this.prisma.registrationDocumentIntake.deleteMany({
        where: { id: intakeId, tenant_id: tenantId },
      });
      throw registrationStoreFailed();
    }

    await this.prisma.registrationDocumentIntake.updateMany({
      where: { id: intakeId, tenant_id: tenantId, state: 'UPLOADED' },
      data: { state: 'RUNNING' },
    });

    try {
      const pages = files.map((file, index) => ({
        page: (sides[index] ?? 'FRONT') === 'BACK' ? 2 : index + 1,
        png: file.buffer,
      }));
      const extracted = await this.provider.extract({
        pages,
        promptVersion: REGISTRATION_DOCUMENT_PROMPT_VERSION,
        signal: AbortSignal.timeout(
          Number(process.env.REGISTRATION_INTAKE_EXTRACT_TIMEOUT_MS ?? 60_000),
        ),
      });
      const mergedFields = mergeRegistrationFieldMaps([extracted.fields]);
      const vin =
        typeof mergedFields.vin?.normalized === 'string'
          ? mergedFields.vin.normalized
          : null;
      const { fields, cases: normCases } = normalizeRegistrationEvidenceFields(
        mergedFields,
        vin,
      );
      const providerCases = [...extracted.warnings];
      if (
        !sides.some((side) => side.toUpperCase() === 'BACK') &&
        !extracted.warnings.includes('BACK_NOT_SUPPLIED')
      ) {
        providerCases.push('BACK_NOT_SUPPLIED');
      }
      const match = await this.matchService.buildMatchSnapshot(
        this.prisma,
        tenantId,
        fields,
        [...normCases, ...providerCases],
      );
      const reviewed = await this.prisma.registrationDocumentIntake.updateMany({
        where: {
          id: intakeId,
          tenant_id: tenantId,
          state: 'RUNNING',
          lease_token: leaseToken,
        },
        data: {
          state: 'AWAITING_REVIEW',
          document_kind: extracted.documentKind,
          evidence: {
            documentKind: extracted.documentKind,
            warnings: extracted.warnings,
            fields,
          } as unknown as PrismaTypes.InputJsonValue,
          match_snapshot: match as unknown as PrismaTypes.InputJsonValue,
          provider_id: this.provider.getMetadata().providerId,
          prompt_version: REGISTRATION_DOCUMENT_PROMPT_VERSION,
          lease_token: null,
        },
      });
      if (reviewed.count !== 1) {
        const current = await this.prisma.registrationDocumentIntake.findFirst({
          where: { id: intakeId, tenant_id: tenantId },
        });
        return this.toCreateResponse(current!);
      }
      const intake = await this.prisma.registrationDocumentIntake.findFirst({
        where: { id: intakeId, tenant_id: tenantId },
      });
      return this.toCreateResponse(intake!);
    } catch {
      await this.prisma.registrationDocumentIntake.updateMany({
        where: {
          id: intakeId,
          tenant_id: tenantId,
          state: 'RUNNING',
          lease_token: leaseToken,
        },
        data: {
          state: 'FAILED',
          failure_code: 'REGISTRATION_INTAKE_EXTRACT_FAILED',
          lease_token: null,
        },
      });
      const failed = await this.prisma.registrationDocumentIntake.findFirst({
        where: { id: intakeId, tenant_id: tenantId },
      });
      return this.toCreateResponse(failed!);
    }
  }

  async get(id: string) {
    assertRegistrationIntakeRole(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const intake = await this.prisma.registrationDocumentIntake.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
    });
    if (!intake) {
      throw registrationIntakeNotFound(id);
    }
    return this.toDetailResponse(intake);
  }

  async apply(id: string, dto: ApplyRegistrationIntakeDto) {
    return this.applyService.apply(id, dto);
  }

  async createOrder(
    id: string,
    dto: Pick<
      CreateWorkshopOrderDto,
      'odometer' | 'fuelLevel' | 'reportedIssue' | 'notes'
    >,
  ): Promise<{
    state: string;
    workshopOrderId: string;
    capturedSiteId: string;
  }> {
    assertRegistrationIntakeRole(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const intake = await this.prisma.registrationDocumentIntake.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!intake) {
      throw registrationIntakeNotFound(id);
    }
    if (intake.site_id !== siteId) {
      throw registrationIntakeNotFound(id);
    }
    if (intake.state !== 'APPLIED') {
      throw registrationStateChanged();
    }
    if (intake.applied_workshop_order_id) {
      return {
        state: 'APPLIED',
        workshopOrderId: intake.applied_workshop_order_id,
        capturedSiteId: intake.site_id,
      };
    }
    const order = await this.workshopIntake.createAtSite(
      {
        ...dto,
        customerId: intake.applied_customer_id!,
        vehicleId: intake.applied_vehicle_id!,
      },
      intake.site_id,
    );
    await this.prisma.registrationDocumentIntake.updateMany({
      where: { id, tenant_id: tenantId, applied_workshop_order_id: null },
      data: { applied_workshop_order_id: order.id },
    });
    return {
      state: 'APPLIED',
      workshopOrderId: order.id,
      capturedSiteId: intake.site_id,
    };
  }

  async abort(id: string) {
    return this.transitionWithByteDelete(id, 'ABORTED', false);
  }

  async delete(id: string) {
    assertRegistrationIntakeRole(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const intake = await this.loadScoped(id, tenantId, siteId);
    if (intake.state === 'APPLIED') {
      throw registrationAppliedDelete();
    }
    await this.byteStorage.deleteIntakePrefix({
      tenantId,
      intakeId: id,
    });
    await this.prisma.registrationDocumentIntake.deleteMany({
      where: { id, tenant_id: tenantId },
    });
  }

  async purgeBytes(id: string) {
    assertRegistrationIntakeRole(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await this.loadScoped(id, tenantId, siteId);
    const purge = await this.prisma.registrationIntakeBytePurge.findFirst({
      where: { intake_id: id, tenant_id: tenantId, processed_at: null },
    });
    if (!purge) {
      return { processed: true };
    }
    try {
      await this.byteStorage.deleteIntakePrefix({ tenantId, intakeId: id });
      await this.prisma.registrationIntakeBytePurge.updateMany({
        where: { id: purge.id, processed_at: null },
        data: { processed_at: new Date(), last_error: null },
      });
      return { processed: true };
    } catch (error) {
      await this.prisma.registrationIntakeBytePurge.updateMany({
        where: { id: purge.id, processed_at: null },
        data: {
          attempts: purge.attempts + 1,
          last_error:
            error instanceof Error
              ? error.message.slice(0, 512)
              : 'delete failed',
        },
      });
      throw registrationBytesRemain();
    }
  }

  private async transitionWithByteDelete(
    id: string,
    target: 'ABORTED',
    allowApplied: boolean,
  ) {
    assertRegistrationIntakeRole(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const intake = await this.loadScoped(id, tenantId, siteId);
    if (intake.state === 'APPLIED' && !allowApplied) {
      throw registrationAppliedDelete();
    }
    if (intake.state === target) {
      return { state: target, bytesDeleted: true };
    }
    try {
      await this.byteStorage.deleteIntakePrefix({ tenantId, intakeId: id });
    } catch {
      throw registrationBytesRemain();
    }
    await this.prisma.registrationDocumentIntake.updateMany({
      where: { id, tenant_id: tenantId },
      data: { state: target },
    });
    return { state: target, bytesDeleted: true };
  }

  private async loadScoped(id: string, tenantId: string, siteId: string) {
    const intake = await this.prisma.registrationDocumentIntake.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
    });
    if (!intake) {
      throw registrationIntakeNotFound(id);
    }
    return intake;
  }

  private validateIdempotencyKey(key: string) {
    if (!key || !REGISTRATION_INTAKE_IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw registrationIdempotencyKeyInvalid();
    }
  }

  private computeRequestHash(
    files: Express.Multer.File[],
    sides: string[],
    userId: string,
    siteId: string,
  ): string {
    const hash = createHash('sha256');
    for (const file of files) {
      hash.update(file.buffer);
    }
    hash.update(JSON.stringify(sides));
    hash.update(userId);
    hash.update(siteId);
    return hash.digest('hex');
  }

  private toCreateResponse(intake: {
    id: string;
    state: RegistrationDocumentIntakeState;
    failure_code: string | null;
    document_kind: string | null;
    evidence: unknown;
    match_snapshot: unknown;
  }) {
    return {
      id: intake.id,
      state: intake.state,
      failureCode: intake.failure_code,
      documentKind: intake.document_kind,
      evidence: intake.evidence,
      matchSnapshot: intake.match_snapshot,
    };
  }

  private toDetailResponse(intake: {
    id: string;
    state: RegistrationDocumentIntakeState;
    failure_code: string | null;
    document_kind: string | null;
    evidence: unknown;
    match_snapshot: unknown;
    applied_customer_id: string | null;
    applied_vehicle_id: string | null;
    applied_workshop_order_id: string | null;
    site_id: string;
  }) {
    return {
      ...this.toCreateResponse(intake),
      appliedCustomerId: intake.applied_customer_id,
      appliedVehicleId: intake.applied_vehicle_id,
      appliedWorkshopOrderId: intake.applied_workshop_order_id,
      capturedSiteId: intake.site_id,
    };
  }
}

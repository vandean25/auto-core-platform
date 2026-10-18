import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  NotificationChannel,
  NotificationRecipientKind,
  TenantMemberRole,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ActionCodeSettings } from 'firebase-admin/auth';
import { getFirebaseAdminAuth } from '../auth/firebase-admin.js';
import {
  NotificationOutboxService,
  type NotificationOutboxTxClient,
} from '../notifications/notification-outbox.service.js';
import { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { setActiveTenant } from '../common/services/user-active-tenant.js';
import {
  readLandingDemoAccessConfig,
  type LandingDemoAccessConfig,
} from './landing-demo-access.config.js';
import type { LandingDemoAccessRequestDto } from './landing-demo-access.dto.js';
import {
  demoAccessExpiresAt,
  demoMagicLinkExpiresAt,
  hashClientIp,
  hashDemoEmail,
  isLandingDemoHoneypotTriggered,
  isLandingDemoSingleLineText,
  normalizeDemoEmail,
} from './demo-role-restrictions.js';
import {
  renderLandingDemoMagicLinkEmail,
  renderLandingDemoOperatorAlertEmail,
} from './landing-demo-access.email.js';
import { PublicRateLimitStore } from './public-rate-limit.store.js';
import { TurnstileVerifier } from './turnstile.verifier.js';
import { LandingDemoSignInGrantService } from './landing-demo-sign-in-grant.service.js';

export type LandingDemoSubmitMeta = {
  ip: string | null;
};

const RATE_LIMIT_SCOPE_IP = 'landing_demo_ip';
const RATE_LIMIT_SCOPE_EMAIL = 'landing_demo_email';

@Injectable()
export class LandingDemoAccessService {
  private readonly logger = new Logger(LandingDemoAccessService.name);
  private readonly config: LandingDemoAccessConfig;

  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly rateLimits: PublicRateLimitStore,
    private readonly turnstile: TurnstileVerifier,
    private readonly outbox: NotificationOutboxService,
    private readonly notificationWakeUps: NotificationCloudTasksService,
    private readonly demoGrants: LandingDemoSignInGrantService,
  ) {
    this.config = readLandingDemoAccessConfig();
  }

  getConfig(): LandingDemoAccessConfig {
    return this.config;
  }

  async submit(
    body: LandingDemoAccessRequestDto,
    meta: LandingDemoSubmitMeta,
  ): Promise<{ ok: true }> {
    if (isLandingDemoHoneypotTriggered(body.website)) {
      return { ok: true };
    }

    if (!this.config.enabled) {
      throw new ServiceUnavailableException(
        'Demo self-service is not enabled in this environment.',
      );
    }

    const captchaOk = await this.turnstile.verify(this.config, {
      token: body.turnstileToken,
      remoteIp: meta.ip,
    });
    if (!captchaOk) {
      throw new UnprocessableEntityException({
        code: 'LANDING_DEMO_CAPTCHA_FAILED',
        message: 'Die Sicherheitsprüfung ist fehlgeschlagen.',
      });
    }

    await this.assertRateLimits(body.email, meta.ip);

    const demoTenant = await this.systemPrisma.tenant.findFirst({
      where: {
        slug: this.config.demoTenantSlug,
        is_landing_demo_tenant: true,
        is_active: true,
      },
      select: { id: true, name: true, default_locale: true },
    });

    if (!demoTenant) {
      throw new ServiceUnavailableException(
        'Demo tenant is not provisioned in this environment.',
      );
    }

    const now = new Date();
    const normalizedEmail = normalizeDemoEmail(body.email);
    const name = body.name.trim();
    const betrieb = body.betrieb.trim();
    if (!name || !betrieb) {
      throw new UnprocessableEntityException({
        code: 'LANDING_DEMO_INVALID_REQUEST',
        message: 'Name und Betrieb sind erforderlich.',
      });
    }
    if (
      !isLandingDemoSingleLineText(name) ||
      !isLandingDemoSingleLineText(betrieb)
    ) {
      throw new UnprocessableEntityException({
        code: 'LANDING_DEMO_INVALID_REQUEST',
        message: 'Name und Betrieb dürfen keine Zeilenumbrüche enthalten.',
      });
    }

    const skipProvisioning =
      await this.shouldSkipProvisioningForExistingAccount(normalizedEmail);

    const accessRequest =
      await this.systemPrisma.landingDemoAccessRequest.create({
        data: {
          id: randomUUID(),
          email: normalizedEmail,
          name,
          betrieb,
          telefon: body.telefon?.trim() || null,
          nachricht: body.nachricht?.trim() || null,
          consent_recorded_at: now,
          client_ip_hash: hashClientIp(meta.ip),
        },
      });

    if (skipProvisioning) {
      await this.enqueueOperatorAlertOnly({
        demoTenantId: demoTenant.id,
        accessRequestId: accessRequest.id,
        name: accessRequest.name,
        betrieb: accessRequest.betrieb,
        email: accessRequest.email,
        telefon: accessRequest.telefon,
        nachricht: accessRequest.nachricht,
        existingAccountBlocked: true,
      });
      return { ok: true };
    }

    let provisioned: { userId: string; firebaseUid: string };
    try {
      provisioned = await this.provisionDemoUser({
        email: normalizedEmail,
        demoTenantId: demoTenant.id,
        now,
      });
    } catch (cause) {
      this.logger.error(
        `Landing demo provisioning failed for ${normalizedEmail}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      throw new ServiceUnavailableException(
        'Demo access could not be provisioned right now.',
      );
    }

    const { userId, firebaseUid } = provisioned;

    try {
      await this.systemPrisma.$transaction(async (tx) => {
        const outboxTx = tx as unknown as NotificationOutboxTxClient;

        await tx.landingDemoSignInGrant.updateMany({
          where: {
            user_id: userId,
            invalidated_at: null,
          },
          data: { invalidated_at: now },
        });

        const grantExpiresAt = demoMagicLinkExpiresAt(now);
        const grant = await tx.landingDemoSignInGrant.create({
          data: {
            id: randomUUID(),
            access_request_id: accessRequest.id,
            user_id: userId,
            expires_at: grantExpiresAt,
          },
        });

        const signInUrl = await this.buildMagicSignInUrl(
          normalizedEmail,
          this.config.signInContinueUrl,
        );

        const magicDraft = renderLandingDemoMagicLinkEmail({
          recipientEmail: normalizedEmail,
          signInUrl,
          validUntil: grantExpiresAt,
          betrieb: accessRequest.betrieb,
          documentLocale: demoTenant.default_locale,
        });
        const operatorDraft = renderLandingDemoOperatorAlertEmail({
          operatorEmail: this.config.operatorEmail,
          name: accessRequest.name,
          betrieb: accessRequest.betrieb,
          email: accessRequest.email,
          telefon: accessRequest.telefon,
          nachricht: accessRequest.nachricht,
        });

        const magicEnqueue = await this.outbox.enqueueInTx(outboxTx, {
          tenantId: demoTenant.id,
          eventType: 'LANDING_DEMO_MAGIC_LINK',
          occurrenceId: grant.id,
          channel: NotificationChannel.EMAIL,
          recipientKind: NotificationRecipientKind.CUSTOMER,
          recipientKey: `landing-demo:${normalizedEmail}`,
          sourceEntityType: 'landing_demo_sign_in_grant',
          sourceEntityId: grant.id,
          email: magicDraft,
          payload: {
            consentTextVersion: this.config.consentTextVersion,
          },
        });

        const operatorEnqueue = await this.outbox.enqueueInTx(outboxTx, {
          tenantId: demoTenant.id,
          eventType: 'LANDING_DEMO_OPERATOR_ALERT',
          occurrenceId: accessRequest.id,
          channel: NotificationChannel.EMAIL,
          recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
          recipientKey: 'landing-demo-operator',
          sourceEntityType: 'landing_demo_access_request',
          sourceEntityId: accessRequest.id,
          email: operatorDraft,
        });

        if (!magicEnqueue.blocked && magicEnqueue.created) {
          await this.wakeUpOutboxRow(magicEnqueue.id, demoTenant.id);
        }
        if (!operatorEnqueue.blocked && operatorEnqueue.created) {
          await this.wakeUpOutboxRow(operatorEnqueue.id, demoTenant.id);
        }
      });
    } catch (cause) {
      this.logger.error(
        `Landing demo outbox transaction failed for ${normalizedEmail}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      await this.systemPrisma.landingDemoSignInGrant.updateMany({
        where: {
          user_id: userId,
          access_request_id: accessRequest.id,
          consumed_at: null,
        },
        data: { invalidated_at: now },
      });
      throw new ServiceUnavailableException(
        'Demo access could not be completed right now.',
      );
    }

    await this.syncDemoClaims(firebaseUid, demoTenant.id);

    return { ok: true };
  }

  private async enqueueOperatorAlertOnly(input: {
    demoTenantId: string;
    accessRequestId: string;
    name: string;
    betrieb: string;
    email: string;
    telefon: string | null;
    nachricht: string | null;
    existingAccountBlocked: boolean;
  }): Promise<void> {
    const operatorDraft = renderLandingDemoOperatorAlertEmail({
      operatorEmail: this.config.operatorEmail,
      name: input.name,
      betrieb: input.betrieb,
      email: input.email,
      telefon: input.telefon,
      nachricht: input.nachricht,
      existingAccountBlocked: input.existingAccountBlocked,
    });

    await this.systemPrisma.$transaction(async (tx) => {
      const outboxTx = tx as unknown as NotificationOutboxTxClient;
      const operatorEnqueue = await this.outbox.enqueueInTx(outboxTx, {
        tenantId: input.demoTenantId,
        eventType: 'LANDING_DEMO_OPERATOR_ALERT',
        occurrenceId: input.accessRequestId,
        channel: NotificationChannel.EMAIL,
        recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
        recipientKey: 'landing-demo-operator',
        sourceEntityType: 'landing_demo_access_request',
        sourceEntityId: input.accessRequestId,
        email: operatorDraft,
      });
      if (!operatorEnqueue.blocked && operatorEnqueue.created) {
        await this.wakeUpOutboxRow(operatorEnqueue.id, input.demoTenantId);
      }
    });
  }

  private async shouldSkipProvisioningForExistingAccount(
    normalizedEmail: string,
  ): Promise<boolean> {
    const firebaseAuth = getFirebaseAdminAuth();
    const firebaseUser = await firebaseAuth
      .getUserByEmail(normalizedEmail)
      .catch(() => null);

    if (
      firebaseUser?.email &&
      normalizeDemoEmail(firebaseUser.email) !== normalizedEmail
    ) {
      return true;
    }

    if (firebaseUser) {
      const linkedByUid = await this.systemPrisma.user.findFirst({
        where: { firebaseUid: firebaseUser.uid },
        select: { id: true, email: true },
      });
      if (linkedByUid) {
        if (normalizeDemoEmail(linkedByUid.email) !== normalizedEmail) {
          return true;
        }
        if (
          await this.demoGrants.userHasNonDemoActiveMembership(linkedByUid.id)
        ) {
          return true;
        }
      }
    }

    const existingUser = await this.systemPrisma.user.findFirst({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (
      existingUser !== null &&
      (await this.demoGrants.userHasNonDemoActiveMembership(existingUser.id))
    ) {
      return true;
    }

    return false;
  }

  private async assertRateLimits(
    email: string,
    ip: string | null,
  ): Promise<void> {
    const ipKey = hashClientIp(ip) ?? 'unknown';
    const emailKey = hashDemoEmail(email);

    const ipDecision = await this.rateLimits.consume(
      { scope: RATE_LIMIT_SCOPE_IP, key: ipKey },
      {
        max: this.config.rateLimitIp.max,
        ttlMs: this.config.rateLimitIp.ttlSeconds * 1000,
      },
    );
    if (!ipDecision.allowed) {
      throw new HttpException(
        {
          code: 'LANDING_DEMO_RATE_LIMITED',
          message: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.',
          retryAfterSeconds: ipDecision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const emailDecision = await this.rateLimits.consume(
      { scope: RATE_LIMIT_SCOPE_EMAIL, key: emailKey },
      {
        max: this.config.rateLimitEmail.max,
        ttlMs: this.config.rateLimitEmail.ttlSeconds * 1000,
      },
    );
    if (!emailDecision.allowed) {
      throw new HttpException(
        {
          code: 'LANDING_DEMO_RATE_LIMITED',
          message: 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.',
          retryAfterSeconds: emailDecision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async provisionDemoUser(input: {
    email: string;
    demoTenantId: string;
    now: Date;
  }): Promise<{ userId: string; firebaseUid: string }> {
    const firebaseAuth = getFirebaseAdminAuth();
    let firebaseUser = await firebaseAuth
      .getUserByEmail(input.email)
      .catch(() => null);

    const linkedBeforeCreate = firebaseUser
      ? await this.systemPrisma.user.findFirst({
          where: { firebaseUid: firebaseUser.uid },
          select: { id: true, email: true },
        })
      : null;

    if (
      linkedBeforeCreate &&
      normalizeDemoEmail(linkedBeforeCreate.email) !== input.email
    ) {
      throw new UnprocessableEntityException({
        code: 'LANDING_DEMO_ACCOUNT_CONFLICT',
        message: 'Demo access cannot be provisioned for this email.',
      });
    }

    if (!firebaseUser) {
      firebaseUser = await firebaseAuth.createUser({
        email: input.email,
        emailVerified: false,
      });
    } else if (firebaseUser.disabled) {
      firebaseUser = await firebaseAuth.updateUser(firebaseUser.uid, {
        disabled: false,
      });
    }

    const expiresAt = demoAccessExpiresAt(input.now);

    let user = await this.systemPrisma.user.findFirst({
      where: {
        OR: [{ firebaseUid: firebaseUser.uid }, { email: input.email }],
      },
    });

    if (
      user &&
      normalizeDemoEmail(user.email) !== input.email &&
      (await this.demoGrants.userHasNonDemoActiveMembership(user.id))
    ) {
      throw new UnprocessableEntityException({
        code: 'LANDING_DEMO_ACCOUNT_CONFLICT',
        message: 'Demo access cannot be provisioned for this email.',
      });
    }

    const isNewUser = !user;
    if (!user) {
      user = await this.systemPrisma.user.create({
        data: {
          email: input.email,
          firebaseUid: firebaseUser.uid,
          active_tenant_id: input.demoTenantId,
        },
      });
    } else if (user.firebaseUid !== firebaseUser.uid) {
      user = await this.systemPrisma.user.update({
        where: { id: user.id },
        data: {
          email: input.email,
          firebaseUid: user.firebaseUid ?? firebaseUser.uid,
        },
      });
    }

    const shouldSetActiveTenant =
      isNewUser ||
      !(await this.demoGrants.userHasNonDemoActiveMembership(user.id));

    if (shouldSetActiveTenant) {
      await setActiveTenant(
        this.systemPrisma.user,
        user.id,
        input.demoTenantId,
      );
    }

    await this.systemPrisma.tenantMember.upsert({
      where: {
        tenant_id_user_id: {
          tenant_id: input.demoTenantId,
          user_id: user.id,
        },
      },
      update: {
        role: TenantMemberRole.DEMO,
        is_active: true,
        demo_access_expires_at: expiresAt,
      },
      create: {
        tenant_id: input.demoTenantId,
        user_id: user.id,
        role: TenantMemberRole.DEMO,
        is_active: true,
        demo_access_expires_at: expiresAt,
      },
    });

    const demoSite = await this.systemPrisma.site.findFirst({
      where: { tenant_id: input.demoTenantId, is_active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    if (demoSite && shouldSetActiveTenant) {
      await this.systemPrisma.siteMembership.upsert({
        where: {
          tenant_id_user_id_site_id: {
            tenant_id: input.demoTenantId,
            user_id: user.id,
            site_id: demoSite.id,
          },
        },
        update: { is_active: true },
        create: {
          tenant_id: input.demoTenantId,
          user_id: user.id,
          site_id: demoSite.id,
          is_active: true,
        },
      });
      await this.systemPrisma.user.update({
        where: { id: user.id },
        data: { active_site_id: demoSite.id },
      });
    }

    return { userId: user.id, firebaseUid: firebaseUser.uid };
  }

  private async buildMagicSignInUrl(
    email: string,
    continueUrl: string | undefined,
  ): Promise<string> {
    if (!continueUrl) {
      throw new BadRequestException(
        'LANDING_DEMO_SIGN_IN_CONTINUE_URL is not configured.',
      );
    }

    const actionCodeSettings: ActionCodeSettings = {
      url: continueUrl,
      handleCodeInApp: true,
    };

    return getFirebaseAdminAuth().generateSignInWithEmailLink(
      email,
      actionCodeSettings,
    );
  }

  private async wakeUpOutboxRow(
    outboxId: string,
    tenantId: string,
  ): Promise<void> {
    await this.notificationWakeUps
      .enqueueWakeUp({ outboxId, tenantId })
      .catch((cause: unknown) =>
        this.logger.warn(
          `Could not schedule notification ${outboxId}: ${
            cause instanceof Error ? cause.name : 'unknown error'
          }`,
        ),
      );
  }

  private async syncDemoClaims(
    firebaseUid: string,
    demoTenantId: string,
  ): Promise<void> {
    const firebaseAuth = getFirebaseAdminAuth();
    const firebaseUser = await firebaseAuth.getUser(firebaseUid);
    const nextClaims = {
      ...(firebaseUser.customClaims ?? {}),
      tenantId: demoTenantId,
      role: TenantMemberRole.DEMO,
    };
    delete (nextClaims as Record<string, unknown>).platformRole;
    await firebaseAuth.setCustomUserClaims(firebaseUid, nextClaims);
  }
}

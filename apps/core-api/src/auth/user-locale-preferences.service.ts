import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DisplayLanguage } from '@prisma/client';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  DEFAULT_FORMAT_LOCALE,
} from '../common/i18n/display-language.js';
import { resolveUserLanguage } from '../common/i18n/locale-resolution.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import type { AuthenticatedUser } from './types/authenticated-user.js';
import type { UserLocalePreferencesResponseDto } from './dto/user-locale-preferences.dto.js';

type PreferenceUserRow = {
  id: string;
  firebaseUid: string;
  locale: DisplayLanguage | null;
  active_tenant_id: string | null;
  memberships: Array<{
    tenant_id: string;
    is_active: boolean;
    tenant: {
      default_locale: DisplayLanguage;
      format_locale: string;
      is_active: boolean;
    };
  }>;
};

const USER_PREFERENCE_SELECT = {
  id: true,
  firebaseUid: true,
  locale: true,
  active_tenant_id: true,
  memberships: {
    where: { is_active: true, tenant: { is_active: true } },
    select: {
      tenant_id: true,
      is_active: true,
      tenant: {
        select: {
          default_locale: true,
          format_locale: true,
          is_active: true,
        },
      },
    },
  },
} as const;

@Injectable()
export class UserLocalePreferencesService {
  constructor(private readonly systemPrisma: SystemPrismaService) {}

  async getForPrincipal(
    principal: AuthenticatedUser,
  ): Promise<UserLocalePreferencesResponseDto> {
    const user = await this.loadUserByFirebaseUid(principal.userId);
    const tenantDefaults = this.resolveTenantDefaults(user, principal);
    const effectiveLocale = resolveUserLanguage(
      user.locale,
      tenantDefaults.defaultLocale,
    );
    return {
      locale: user.locale,
      effectiveLocale,
      defaultLocale: tenantDefaults.defaultLocale,
      formatLocale: tenantDefaults.formatLocale,
    };
  }

  async patchForPrincipal(
    principal: AuthenticatedUser,
    locale: DisplayLanguage | null,
  ): Promise<UserLocalePreferencesResponseDto> {
    const user = await this.loadUserByFirebaseUid(principal.userId);
    await this.systemPrisma.user.update({
      where: { id: user.id },
      data: { locale },
    });
    return this.getForPrincipal(principal);
  }

  async buildSessionPreferenceFields(
    firebaseUid: string,
    activeTenantId: string,
  ): Promise<UserLocalePreferencesResponseDto> {
    const user = await this.systemPrisma.user.findFirst({
      where: { firebaseUid },
      select: USER_PREFERENCE_SELECT,
    });
    if (!user) {
      return {
        locale: null,
        effectiveLocale: DEFAULT_DISPLAY_LANGUAGE,
        defaultLocale: DEFAULT_DISPLAY_LANGUAGE,
        formatLocale: DEFAULT_FORMAT_LOCALE,
      };
    }
    const membership = user.memberships.find(
      (row) => row.tenant_id === activeTenantId,
    );
    const defaultLocale =
      membership?.tenant.default_locale ?? DEFAULT_DISPLAY_LANGUAGE;
    const formatLocale = membership?.tenant.format_locale ?? DEFAULT_FORMAT_LOCALE;
    return {
      locale: user.locale,
      effectiveLocale: resolveUserLanguage(user.locale, defaultLocale),
      defaultLocale,
      formatLocale,
    };
  }

  private async loadUserByFirebaseUid(
    firebaseUid: string,
  ): Promise<PreferenceUserRow> {
    const user = await this.systemPrisma.user.findFirst({
      where: { firebaseUid },
      select: USER_PREFERENCE_SELECT,
    });
    if (!user?.firebaseUid) {
      throw new NotFoundException('User not found.');
    }
    return { ...user, firebaseUid: user.firebaseUid };
  }

  private resolveTenantDefaults(
    user: PreferenceUserRow,
    principal: AuthenticatedUser,
  ): { defaultLocale: DisplayLanguage; formatLocale: string } {
    const tenantId =
      ('tenantId' in principal && principal.tenantId) ||
      user.active_tenant_id ||
      null;
    if (!tenantId) {
      return {
        defaultLocale: DEFAULT_DISPLAY_LANGUAGE,
        formatLocale: DEFAULT_FORMAT_LOCALE,
      };
    }
    const membership = user.memberships.find(
      (row) => row.tenant_id === tenantId,
    );
    if (!membership) {
      if ('tenantId' in principal && principal.tenantId) {
        throw new ForbiddenException('Active tenant membership is required.');
      }
      return {
        defaultLocale: DEFAULT_DISPLAY_LANGUAGE,
        formatLocale: DEFAULT_FORMAT_LOCALE,
      };
    }
    return {
      defaultLocale: membership.tenant.default_locale,
      formatLocale: membership.tenant.format_locale,
    };
  }
}

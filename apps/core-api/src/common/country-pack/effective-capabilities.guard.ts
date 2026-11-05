import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthSessionService } from '../../auth/auth-session.service.js';
import { TenantContextService } from '../services/tenant-context.service.js';
import type { CountryCapabilities } from './country-pack.registry.js';

const CAPABILITY_KEY = 'requiredCountryCapability';
type CapabilityRule = {
  capability: keyof CountryCapabilities;
  profile?: string;
  bodyFlag?: string;
};

/**
 * Mirrors `resolveListingSerializer`, which trims the profile before lookup,
 * so a padded value such as `%20WILLHABEN_GENERIC_V1` cannot skip the gate.
 * A repeated query key (array) fails closed and is treated as a match.
 */
function profileMatches(raw: unknown, expected: string): boolean {
  if (Array.isArray(raw)) return true;
  return typeof raw === 'string' && raw.trim() === expected;
}

@Injectable()
export class EffectiveCapabilitiesService {
  constructor(
    private readonly sessions: AuthSessionService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async resolve(): Promise<CountryCapabilities | null> {
    const user = this.tenantContext.getAuthenticatedUser();
    if (!user || ('apiKeyId' in user && user.apiKeyId)) return null;
    return (await this.sessions.getSessionForAuthenticatedUser(user))
      .effectiveCapabilities;
  }

  /** True only when the effective capability is on; unconfigured (`null`) is off. */
  async isAvailable(capability: keyof CountryCapabilities): Promise<boolean> {
    return (await this.resolve())?.[capability] === true;
  }
}

@Injectable()
export class CapabilityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly capabilities: EffectiveCapabilitiesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<CapabilityRule>(
      CAPABILITY_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!rule) return true;
    const request = context.switchToHttp().getRequest<{
      query: { profile?: unknown };
      body?: Record<string, unknown>;
    }>();
    if (rule.profile && !profileMatches(request.query.profile, rule.profile))
      return true;
    if (rule.bodyFlag && request.body?.[rule.bodyFlag] !== true) return true;
    if (await this.capabilities.isAvailable(rule.capability)) return true;
    throw new ForbiddenException({
      code: 'CAPABILITY_UNAVAILABLE',
      message: 'This feature is unavailable for the active legal entity.',
    });
  }
}

export function RequireCapability(
  capability: keyof CountryCapabilities,
  options: { profile?: string; bodyFlag?: string } = {},
) {
  return applyDecorators(
    SetMetadata(CAPABILITY_KEY, { capability, ...options }),
    UseGuards(CapabilityGuard),
  );
}

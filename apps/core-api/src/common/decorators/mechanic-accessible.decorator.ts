import { SetMetadata } from '@nestjs/common';

export const MECHANIC_ACCESSIBLE_KEY = 'mechanicAccessible';

/**
 * Marks a controller or route handler as accessible to mechanic-mode sessions
 * (TenantMemberRole.TECH).
 *
 * The global JwtAuthGuard rejects any request from a TECH-role user that
 * reaches an endpoint not decorated with @MechanicAccessible() or @Public().
 * Apply this decorator at the controller class level for fully mechanic-facing
 * controllers (e.g. MechanicController) or at the handler level for individual
 * endpoints that mechanics are permitted to call (e.g. GET /auth/me).
 *
 * ADR-0014 §8.2 — Technical acceptance criteria items 1-3.
 */
export const MechanicAccessible = () =>
  SetMetadata(MECHANIC_ACCESSIBLE_KEY, true);

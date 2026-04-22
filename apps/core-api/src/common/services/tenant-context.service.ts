import {
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { TenantContextStorage } from './tenant-context.storage';

@Injectable()
export class TenantContextService {
  private defaultTenantIdPromise?: Promise<string>;

  constructor(private readonly prisma: PrismaService) {}

  setAuthenticatedUser(user: AuthenticatedUser) {
    TenantContextStorage.setUser(user);
  }

  setTenantIdForWorker(tenantId: string): void {
    this.setAuthenticatedUser({
      userId: 'cloud-tasks-worker',
      email: '',
      tenantId,
      role: 'worker',
    });
  }

  getAuthenticatedUser(): AuthenticatedUser | undefined {
    return TenantContextStorage.getUser();
  }

  /**
   * Returns the current tenant ID synchronously from the AsyncLocalStorage context.
   * Throws InternalServerErrorException if no tenant context has been set for this request.
   * Use this in Prisma extensions and other synchronous-context code paths.
   */
  getRequiredTenantId(): string {
    const user = TenantContextStorage.getUser();
    if (!user?.tenantId) {
      throw new InternalServerErrorException(
        'Tenant context not initialised. Is the JwtAuthGuard applied?',
      );
    }
    return user.tenantId;
  }

  async getTenantId(): Promise<string> {
    const user = this.getAuthenticatedUser();
    if (user?.tenantId) {
      return user.tenantId;
    }

    if (!this.defaultTenantIdPromise) {
      this.defaultTenantIdPromise = this.resolveDefaultTenantId().catch(
        (error) => {
          this.defaultTenantIdPromise = undefined;
          throw error;
        },
      );
    }

    return this.defaultTenantIdPromise;
  }

  private async resolveDefaultTenantId(): Promise<string> {
    if (process.env.DEFAULT_TENANT_ID) {
      return process.env.DEFAULT_TENANT_ID;
    }

    const defaultTenantSlug =
      process.env.DEFAULT_TENANT_SLUG ?? 'default-workshop';
    const tenant = await this.prisma.tenant.findFirst({
      where: { slug: defaultTenantSlug },
      select: { id: true },
    });

    if (!tenant) {
      throw new UnauthorizedException('No tenant context is available.');
    }

    return tenant.id;
  }
}

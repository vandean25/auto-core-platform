import { Injectable, UnauthorizedException } from '@nestjs/common';
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
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: defaultTenantSlug },
      select: { id: true },
    });

    if (!tenant) {
      throw new UnauthorizedException('No tenant context is available.');
    }

    return tenant.id;
  }
}
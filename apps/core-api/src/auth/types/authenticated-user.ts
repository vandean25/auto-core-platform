export type TenantAuthenticatedUser = {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  platformRole?: string;
};

export type PlatformAuthenticatedUser = {
  userId: string;
  email: string;
  platformRole: string;
  tenantId?: string;
  role?: string;
};

export type AuthenticatedUser =
  | TenantAuthenticatedUser
  | PlatformAuthenticatedUser;

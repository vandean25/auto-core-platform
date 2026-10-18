export interface CallerAccess {
  userId: string;
  tenantId: string;
  accessBySite: Map<string, string>;
  isAdmin: boolean;
}

export type AuditJsonPrimitive = string | number | boolean | null;

export type AuditJsonValue =
  AuditJsonPrimitive | AuditJsonValue[] | { [key: string]: AuditJsonValue };

export type AuditObject = Record<string, AuditJsonValue | undefined>;

export type AuditFieldDiff = {
  before: AuditJsonValue | undefined;
  after: AuditJsonValue | undefined;
};

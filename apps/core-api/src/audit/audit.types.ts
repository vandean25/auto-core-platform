export type AuditJsonPrimitive = string | number | boolean | null;

export type AuditJsonValue =
  AuditJsonPrimitive | AuditJsonValue[] | { [key: string]: AuditJsonValue };

export type AuditFieldDiff = {
  before: AuditJsonValue | undefined;
  after: AuditJsonValue | undefined;
};

/** Shared fixtures for ImportService job characterization specs. */
export const JOBS_CHARACTERIZATION_CUSTOMER_CSV =
  'Kunden-Nr;Vorname;Nachname\nK-1;Anna;Berger\n';

export const JOBS_CHARACTERIZATION_CUSTOMER_MAPPING = {
  external_id: 'Kunden-Nr',
  first_name: 'Vorname',
  last_name: 'Nachname',
};

export const JOBS_CHARACTERIZATION_DRY_RUN_CREATE_TOTALS = {
  rows: 1,
  create: 1,
  update: 0,
  skip: 0,
  error: 0,
  flagged_jumps: 0,
};

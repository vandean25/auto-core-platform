/**
 * Austrian demo revenue groups seeded for Default Workshop (finance.fixture).
 * Catalog invoice lines resolve accounting via `revenue_group:{id}` for these groups.
 */
export const DEMO_WORKSHOP_REVENUE_GROUP_SPECS = [
  {
    name: 'Parts / Goods 20%',
    tax_rate: 20.0,
    account_number: '4000',
    is_default: true,
  },
  {
    name: 'Services / Labor 20%',
    tax_rate: 20.0,
    account_number: '4001',
    is_default: false,
  },
  {
    name: 'Tax Free / Margin',
    tax_rate: 0.0,
    account_number: '4099',
    is_default: false,
  },
] as const;

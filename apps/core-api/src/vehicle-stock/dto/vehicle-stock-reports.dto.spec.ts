import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  VehicleStockAgeReportQueryDto,
  VehicleStockMarginReportQueryDto,
} from './vehicle-stock-reports.dto.js';

describe('vehicle stock report query DTOs', () => {
  it.each([
    [VehicleStockAgeReportQueryDto, { page: '1e308' }],
    [
      VehicleStockMarginReportQueryDto,
      {
        from: '2026-10-01',
        to: '2026-10-31',
        page: '1e308',
      },
    ],
  ])(
    'rejects page values whose Prisma skip offset cannot be represented safely',
    (Dto, query) => {
      const dto = plainToInstance(Dto, query);

      expect(validateSync(dto)).not.toHaveLength(0);
    },
  );
});

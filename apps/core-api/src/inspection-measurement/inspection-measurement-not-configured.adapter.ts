import { Injectable } from '@nestjs/common';
import type { BrakeMeasurementReadPort } from './inspection-measurement.port.js';

@Injectable()
export class NotConfiguredBrakeMeasurementReadAdapter implements BrakeMeasurementReadPort {
  readMeasurement(
    _connection: unknown, // eslint-disable-line @typescript-eslint/no-unused-vars
    _nativeReference: string, // eslint-disable-line @typescript-eslint/no-unused-vars
  ) {
    return Promise.resolve({ status: 'NOT_CONFIGURED' as const });
  }
}

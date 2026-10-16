import { Injectable } from '@nestjs/common';
import type { BrakeMeasurementReadPort } from './inspection-measurement.port.js';

@Injectable()
export class NotConfiguredBrakeMeasurementReadAdapter
  implements BrakeMeasurementReadPort
{
  readMeasurement(_connection: unknown, _nativeReference: string) {
    return Promise.resolve({ status: 'NOT_CONFIGURED' as const });
  }
}

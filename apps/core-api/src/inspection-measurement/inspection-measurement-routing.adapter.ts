import { Injectable } from '@nestjs/common';
import { FakeBrakeMeasurementReadAdapter } from './inspection-measurement-fake.adapter.js';
import { NotConfiguredBrakeMeasurementReadAdapter } from './inspection-measurement-not-configured.adapter.js';
import type { BrakeMeasurementReadPort } from './inspection-measurement.port.js';
import type { BrakeDeviceConnectionContext } from './inspection-measurement.types.js';

@Injectable()
export class RoutingBrakeMeasurementReadAdapter implements BrakeMeasurementReadPort {
  constructor(
    private readonly fakeAdapter: FakeBrakeMeasurementReadAdapter,
    private readonly nativeAdapter: NotConfiguredBrakeMeasurementReadAdapter,
  ) {}

  readMeasurement(
    connection: BrakeDeviceConnectionContext,
    nativeReference: string,
  ) {
    if (connection.profileId === 'TEST_ONLY') {
      return this.fakeAdapter.readMeasurement(connection, nativeReference);
    }
    return this.nativeAdapter.readMeasurement(connection, nativeReference);
  }
}

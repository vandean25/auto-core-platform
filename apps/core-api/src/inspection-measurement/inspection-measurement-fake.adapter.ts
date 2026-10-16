import { Injectable } from '@nestjs/common';
import { parseCanonicalBrakeMeasurementUtf8 } from './inspection-measurement-canonical.js';
import { lookupSyntheticBrakeMeasurement } from './inspection-measurement-synthetic-fixtures.js';
import type { BrakeMeasurementReadPort } from './inspection-measurement.port.js';
import type { BrakeDeviceConnectionContext } from './inspection-measurement.types.js';

@Injectable()
export class FakeBrakeMeasurementReadAdapter implements BrakeMeasurementReadPort {
  readMeasurement(
    connection: BrakeDeviceConnectionContext,
    nativeReference: string,
  ) {
    if (connection.profileId !== 'TEST_ONLY') {
      return Promise.resolve({ status: 'NOT_CONFIGURED' as const });
    }
    const raw = lookupSyntheticBrakeMeasurement(nativeReference);
    if (!raw) {
      return Promise.resolve({ status: 'NOT_FOUND' as const });
    }
    const canonical = {
      ...raw,
      source_instance_id: connection.sourceInstanceId,
      device_serial: connection.deviceSerial,
      profile_digest: connection.profileDigest,
    };
    const originalUtf8 = JSON.stringify(canonical);
    parseCanonicalBrakeMeasurementUtf8(originalUtf8);
    return Promise.resolve({
      status: 'RESULT' as const,
      canonical,
      originalUtf8,
    });
  }
}

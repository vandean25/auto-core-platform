import type {
  BrakeDeviceConnectionContext,
  BrakeMeasurementFetchEnvelope,
} from './inspection-measurement.types.js';

export const BRAKE_MEASUREMENT_READ_PORT = Symbol(
  'BRAKE_MEASUREMENT_READ_PORT',
);

export interface BrakeMeasurementReadPort {
  readMeasurement(
    connection: BrakeDeviceConnectionContext,
    nativeReference: string,
  ): Promise<BrakeMeasurementFetchEnvelope>;
}

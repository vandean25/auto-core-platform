import type { AccountingExportSerializerPort } from './accounting-export-serializer.types.js';
import { bmdAccountingExportSerializer } from './bmd-accounting-export.serializer.js';
import { datevAccountingExportSerializer } from './datev-accounting-export.serializer.js';
import { rzlAccountingExportSerializer } from './rzl-accounting-export.serializer.js';

/** Every accounting export serializer. The registry indexes them by profile code. */
export const accountingExportSerializers: readonly AccountingExportSerializerPort[] =
  [
    datevAccountingExportSerializer,
    rzlAccountingExportSerializer,
    bmdAccountingExportSerializer,
  ];

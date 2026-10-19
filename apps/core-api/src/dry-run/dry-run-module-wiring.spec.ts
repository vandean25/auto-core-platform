import { MODULE_METADATA } from '@nestjs/common/constants';
import { DryRunModule } from './dry-run.module.js';
import { AppModule } from '../app.module.js';

describe('Dry-run module wiring', () => {
  it('registers DryRunModule in AppModule imports', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule);
    expect(imports).toContain(DryRunModule);
  });
});

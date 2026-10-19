import {
  DryRunSideEffectBlockedException,
  SideEffectGuard,
} from '../dry-run/side-effect-guard.js';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';

describe('MCP write dry_run outbound guard (AUT-612)', () => {
  it('blocks outbound side effects during rollback simulation', () => {
    expect(() =>
      DryRunStorage.run({ isDryRun: true }, () => {
        SideEffectGuard.assertAllowed('GCS_WRITE');
      }),
    ).toThrow(DryRunSideEffectBlockedException);
  });
});

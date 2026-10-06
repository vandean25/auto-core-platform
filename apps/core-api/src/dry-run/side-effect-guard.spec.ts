import {
  SideEffectGuard,
  DryRunSideEffectBlockedException,
} from './side-effect-guard.js';
import { DryRunStorage } from './dry-run.storage.js';
import type { SideEffectType } from './dry-run.types.js';

describe('SideEffectGuard & DryRunStorage', () => {
  const allSideEffects: SideEffectType[] = [
    'QUEUE_ENQUEUE',
    'EMAIL',
    'SMS',
    'NOTIFICATION',
    'FILE_WRITE',
    'GCS_WRITE',
    'EXTERNAL_HTTP',
    'PERSISTED_AUDIT',
  ];

  describe('when dry run is inactive', () => {
    it('returns false for isDryRun()', () => {
      expect(SideEffectGuard.isDryRun()).toBe(false);
      expect(DryRunStorage.isDryRun()).toBe(false);
    });

    it('allows all side effects without throwing', () => {
      for (const effect of allSideEffects) {
        expect(() => SideEffectGuard.assertAllowed(effect)).not.toThrow();
      }
    });

    it('returns undefined for tx and collector', () => {
      expect(DryRunStorage.getTransactionClient()).toBeUndefined();
      expect(DryRunStorage.getCollector()).toBeUndefined();
    });
  });

  describe('when dry run is active', () => {
    it('returns true for isDryRun()', () => {
      DryRunStorage.run({ isDryRun: true }, () => {
        expect(SideEffectGuard.isDryRun()).toBe(true);
        expect(DryRunStorage.isDryRun()).toBe(true);
      });
    });

    it('fails loudly when attempting any side effect during dry run', () => {
      DryRunStorage.run({ isDryRun: true }, () => {
        for (const effect of allSideEffects) {
          expect(() => SideEffectGuard.assertAllowed(effect)).toThrow(
            DryRunSideEffectBlockedException,
          );
          expect(() => SideEffectGuard.assertAllowed(effect)).toThrow(
            `[DryRun] Side effect '${effect}' is blocked during dry run execution.`,
          );
        }
      });
    });

    it('stores and retrieves tx and collector from context', () => {
      const mockTx = { dummy: 'tx' } as any;
      const mockCollector = { dummy: 'collector' } as any;

      DryRunStorage.run(
        { isDryRun: true, tx: mockTx, collector: mockCollector },
        () => {
          expect(DryRunStorage.getTransactionClient()).toBe(mockTx);
          expect(DryRunStorage.getCollector()).toBe(mockCollector);
        },
      );
    });

    it('restores previous context when callback exits', () => {
      expect(DryRunStorage.isDryRun()).toBe(false);

      DryRunStorage.run({ isDryRun: true }, () => {
        expect(DryRunStorage.isDryRun()).toBe(true);
      });

      expect(DryRunStorage.isDryRun()).toBe(false);
    });

    it('handles async callbacks properly', async () => {
      await DryRunStorage.run({ isDryRun: true }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(DryRunStorage.isDryRun()).toBe(true);
        expect(() => SideEffectGuard.assertAllowed('EMAIL')).toThrow(
          DryRunSideEffectBlockedException,
        );
      });

      expect(DryRunStorage.isDryRun()).toBe(false);
    });
  });
});

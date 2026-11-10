import { Injectable } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';
import { advanceScopeEpoch } from './scope-epoch.js';

/**
 * User-wide access status (e.g. IdP disable) that must bump every tenant membership epoch.
 */
@Injectable()
export class UserAccessStatusService {
  constructor(private readonly systemPrisma: SystemPrismaService) {}

  async advanceAllMembershipEpochs(userId: string): Promise<void> {
    await this.systemPrisma.$transaction(async (tx) => {
      await advanceScopeEpoch(tx, { kind: 'allMembershipsForUser', userId });
    });
  }
}

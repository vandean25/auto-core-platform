import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Purges customer consent ledger rows whose proof retention has expired and are not on legal hold.
 * Wired into the same retain_until / legal_hold contract as workshop estimates (ADR-0025).
 */
@Injectable()
export class CustomerConsentRetentionService {
  private readonly logger = new Logger(CustomerConsentRetentionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async purgeExpiredProofRows(now = new Date()): Promise<number> {
    const result = await this.prisma.customerConsent.deleteMany({
      where: {
        retain_until: { lt: now },
        legal_hold: false,
      },
    });
    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} expired customer consent proof rows`);
    }
    return result.count;
  }
}

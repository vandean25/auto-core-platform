import { ConflictException } from '@nestjs/common';
import { AgentProposalStatus, type Prisma } from '@prisma/client';
import { assertWorkshopCommandPresetHardDeleteAllowed } from './workshop-command-preset.lifecycle.js';

describe('assertWorkshopCommandPresetHardDeleteAllowed', () => {
  it('refuses hard delete when a pending proposal references the preset', async () => {
    const prisma = {
      agentProposal: {
        findMany: jest.fn().mockResolvedValue([
          {
            payload_json: {
              position_lines: [{ preset_key: 'service.major' }],
            } as Prisma.JsonValue,
          },
        ]),
      },
    };
    await expect(
      assertWorkshopCommandPresetHardDeleteAllowed(
        prisma as never,
        'tenant-1',
        'service.major',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.agentProposal.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        status: AgentProposalStatus.PENDING,
        action_type: 'workshop.booking_package',
      },
      select: { payload_json: true },
      take: 200,
    });
  });

  it('allows hard delete when no pending proposal references the preset', async () => {
    const prisma = {
      agentProposal: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    await expect(
      assertWorkshopCommandPresetHardDeleteAllowed(
        prisma as never,
        'tenant-1',
        'service.major',
      ),
    ).resolves.toBeUndefined();
  });
});

import { ConflictException } from '@nestjs/common';
import { AgentProposalStatus, type Prisma } from '@prisma/client';
import {
  assertWorkshopCommandPresetHardDeleteAllowed,
  payloadReferencesPresetKey,
} from './workshop-command-preset.lifecycle.js';

describe('payloadReferencesPresetKey', () => {
  it('matches preset_key on position_lines', () => {
    expect(
      payloadReferencesPresetKey(
        { position_lines: [{ preset_key: 'brake.check' }] },
        'brake.check',
      ),
    ).toBe(true);
  });

  it('matches preset_key on reviewed position_plan.lines', () => {
    expect(
      payloadReferencesPresetKey(
        {
          position_plan: {
            lines: [{ preset_key: 'service.major', kind: 'LABOR' }],
          },
        },
        'service.major',
      ),
    ).toBe(true);
  });
});

describe('assertWorkshopCommandPresetHardDeleteAllowed', () => {
  it('refuses hard delete when a pending proposal references the preset in position_lines', async () => {
    const prisma = {
      agentProposal: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p-1',
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
      select: { id: true, payload_json: true },
      orderBy: { id: 'asc' },
      take: 100,
      skip: 0,
    });
  });

  it('refuses when the preset appears only on position_plan.lines', async () => {
    const prisma = {
      agentProposal: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'p-2',
            payload_json: {
              position_plan: { lines: [{ preset_key: 'service.major' }] },
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
  });

  it('pages through pending proposals until the set is exhausted', async () => {
    const prisma = {
      agentProposal: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(
            Array.from({ length: 100 }, (_, index) => ({
              id: `p-${index}`,
              payload_json: { position_lines: [] },
            })),
          )
          .mockResolvedValueOnce([
            {
              id: 'p-hit',
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
    expect(prisma.agentProposal.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.agentProposal.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 100 }),
    );
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
